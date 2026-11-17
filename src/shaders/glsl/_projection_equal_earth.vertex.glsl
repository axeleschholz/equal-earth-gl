// Draws tiles of the mercator grid on the Equal Earth plane, see getWarpedProjectionData in warped_projection_data.ts
// for what each projection uniform holds here, and evaluateExpansion in equal_earth_tile_warp.ts for the expansion.

// Custom layers get this prelude without _prelude.vertex.glsl, which defines PROJECTION_UBO, so they set these as plain uniforms.
#ifndef PROJECTION_UBO
uniform highp vec4 u_projection_tile_mercator_coords;
uniform highp vec4 u_projection_clipping_plane;
uniform highp float u_projection_transition;
uniform mat4 u_projection_fallback_matrix;
#endif

// The in-tile coordinates of the projected vertex, used by clipAntimeridian() in the fragment shader.
out highp float v_projection_tile_x;
out highp float v_projection_tile_y;

// The polynomial coefficients of the Equal Earth projection.
const highp float EE_A1 = 1.340264;
const highp float EE_A2 = -0.081106;
const highp float EE_A3 = 0.000893;
const highp float EE_A4 = 0.003796;
const highp float EE_M = 0.8660254037844386;
// The first eccentricity of the WGS84 ellipsoid, its square, and the authalic function q at the pole.
const highp float EE_E = 0.08181919084262149;
const highp float EE_E2 = 0.00669437999014;
const highp float EE_Q_POLE = 1.9955310875028371;
// World plane units per unit of y on the unit sphere: M * A1 / (2 * PI).
const highp float EE_Y_SCALE = 0.18473248150889978;
// How far apart, in tile units, the two positions are that the slope of the warp across a tile is measured between.
const highp float EE_SLOPE_STEP = 64.0;

float projectLineThickness(float tileY) {
    return 1.0;
}

float projectCircleRadius(float tileY) {
    return 1.0;
}

// 1.0 for a vertex on the north pole, -1.0 for one on the south pole, 0.0 for any other.
float equalEarthPole(vec2 rawPos) {
    if (rawPos.y < -32767.5) {
        return 1.0;
    }
    if (rawPos.y > 32766.5) {
        return -1.0;
    }
    return 0.0;
}

// The warp of a position in the tile, computed in full: the position on the 0..1 world plane.
// xScale receives the plane units per tile unit along x at the position.
vec2 equalEarthWarpExact(float tileX, float tileY, float pole, out float xScale) {
    float mercatorX = u_projection_tile_mercator_coords.x + u_projection_tile_mercator_coords.z * tileX;
    float mercatorY = clamp(u_projection_tile_mercator_coords.y + u_projection_tile_mercator_coords.w * tileY, -0.5, 1.5);
    // The sine of the latitude from mercator y without atan or sin, as on the globe.
    float t = exp(PI - (mercatorY * PI * 2.0));
    float t2 = t * t;
    float sinLat = (t2 - 1.0) / (t2 + 1.0);
    if (pole != 0.0) {
        sinLat = pole;
    }
    float eSin = EE_E * sinLat;
    float q = (1.0 - EE_E2) * (sinLat / (1.0 - eSin * eSin) + atanh(eSin) / EE_E);
    float sinTheta = EE_M * clamp(q / EE_Q_POLE, -1.0, 1.0);
    float theta = asin(sinTheta);
    float cosTheta = sqrt(1.0 - sinTheta * sinTheta);
    float theta2 = theta * theta;
    float theta6 = theta2 * theta2 * theta2;
    float d = EE_A1 + 3.0 * EE_A2 * theta2 + theta6 * (7.0 * EE_A3 + 9.0 * EE_A4 * theta2);
    float xFactor = cosTheta * EE_A1 / d;
    xScale = xFactor * u_projection_tile_mercator_coords.z;
    return vec2(
        0.5 + (mercatorX - 0.5) * xFactor,
        0.5 - theta * (EE_A1 + EE_A2 * theta2 + theta6 * (EE_A3 + EE_A4 * theta2)) * EE_Y_SCALE
    );
}

// The warp of a position in the tile from the tile's expansion: the offset on the world plane from the warp of the
// tile's center. xScale receives the plane units per tile unit along x at the position.
vec2 equalEarthWarpExpansion(float tileX, float tileY, float pole, out float xScale) {
    mat4 m = u_projection_fallback_matrix;
    vec4 last = u_projection_clipping_plane;
    float u = tileX / 8192.0 - 0.5;
    float v = tileY / 8192.0 - 0.5;
    float aDifference;
    float y;
    if (pole != 0.0) {
        aDifference = last.z - m[0][0];
        y = last.w;
    } else {
        float aSlope = m[2][0];
        aSlope = aSlope * v + m[1][3];
        aSlope = aSlope * v + m[1][2];
        aSlope = aSlope * v + m[1][1];
        aSlope = aSlope * v + m[1][0];
        aSlope = aSlope * v + m[0][3];
        aSlope = aSlope * v + m[0][2];
        aSlope = aSlope * v + m[0][1];
        float cSlope = last.y;
        cSlope = cSlope * v + last.x;
        cSlope = cSlope * v + m[3][3];
        cSlope = cSlope * v + m[3][2];
        cSlope = cSlope * v + m[3][1];
        cSlope = cSlope * v + m[3][0];
        cSlope = cSlope * v + m[2][3];
        cSlope = cSlope * v + m[2][2];
        aDifference = aSlope * v;
        y = cSlope * v;
    }
    float a = m[0][0] + aDifference;
    xScale = a / 8192.0;
    return vec2(u * a + m[2][1] * aDifference, y);
}

// The position that u_projection_matrix takes to clip space, for a position in the tile.
// A position in the tile's buffer past the antimeridian stays on it.
vec2 equalEarthWarp(vec2 posInTile, float pole, out float xScale) {
    float minX = -u_projection_tile_mercator_coords.x / u_projection_tile_mercator_coords.z;
    float maxX = (1.0 - u_projection_tile_mercator_coords.x) / u_projection_tile_mercator_coords.z;
    float tileX = clamp(posInTile.x, minX, maxX);
    if (u_projection_transition < 0.5) {
        return equalEarthWarpExact(tileX, posInTile.y, pole, xScale);
    }
    return equalEarthWarpExpansion(tileX, posInTile.y, pole, xScale);
}

vec4 equalEarthProject(vec2 posInTile, float pole, float elevation) {
    v_projection_tile_x = posInTile.x;
    v_projection_tile_y = posInTile.y;
    float xScale;
    return u_projection_matrix * vec4(equalEarthWarp(posInTile, pole, xScale), elevation, 1.0);
}

// Projects a point in tile-local coordinates (usually 0..EXTENT) to screen.
vec4 projectTile(vec2 posInTile) {
    return equalEarthProject(posInTile, 0.0, 0.0);
}

// A variant that supports special pole vertices.
vec4 projectTile(vec2 posInTile, vec2 rawPos) {
    return equalEarthProject(posInTile, equalEarthPole(rawPos), 0.0);
}

vec4 projectTileWithElevation(vec2 posInTile, float elevation) {
    return equalEarthProject(posInTile, 0.0, elevation);
}

vec4 projectTileFor3D(vec2 posInTile, float elevation) {
    return equalEarthProject(posInTile, equalEarthPole(posInTile), elevation);
}

// Projects a point in the tile moved by `extrusion`, the offset in tile units of a flat tile that takes a vertex of
// a line across the line to its edge. The warp stretches a tile differently along x and y and shears it, so an offset
// perpendicular to a line in the tile is not perpendicular to it on screen, nor as long as on a flat tile. This takes
// the line's direction through the warp, and moves the warped point perpendicular to that on the plane, by the length
// a flat tile gives the extrusion.
vec4 projectTileExtruded(vec2 posInTile, vec2 extrusion) {
    v_projection_tile_x = posInTile.x;
    v_projection_tile_y = posInTile.y;
    float a;
    float unused;
    vec2 here = equalEarthWarp(posInTile, 0.0, a);
    float extrusionLength = length(extrusion);
    if (extrusionLength == 0.0) {
        return u_projection_matrix * vec4(here, 0.0, 1.0);
    }
    vec2 below = equalEarthWarp(posInTile + vec2(0.0, EE_SLOPE_STEP), 0.0, unused);
    float b = (below.x - here.x) / EE_SLOPE_STEP;
    float c = (below.y - here.y) / EE_SLOPE_STEP;
    vec2 along = vec2(-extrusion.y, extrusion.x);
    vec2 alongOnPlane = vec2(a * along.x + b * along.y, c * along.y);
    float flatScale = u_projection_tile_mercator_coords.z;
    vec2 onPlane = flatScale * extrusionLength * vec2(alongOnPlane.y, -alongOnPlane.x) / length(alongOnPlane);
    return u_projection_matrix * vec4(here + onPlane, 0.0, 1.0);
}
