in highp float v_projection_tile_x;
in highp float v_projection_tile_y;

// Discards a fragment past an edge of the world, when bit 1 of u_projection_clip_antimeridian says one runs through
// the tile or its buffer. The edges are tile x coordinates: the first two of u_projection_tile_mercator_coords where
// the tile is drawn from its expansion, and derived from the tile's place across the world below that.
// See getWarpedProjectionData in warped_projection_data.ts.
void clipWorldEdge() {
    if ((u_projection_clip_antimeridian & 1) == 0) {
        return;
    }
    highp float west = u_projection_tile_mercator_coords.x;
    highp float east = u_projection_tile_mercator_coords.y;
    if (u_projection_transition < 0.5) {
        west = -u_projection_tile_mercator_coords.x / u_projection_tile_mercator_coords.z;
        east = (1.0 - u_projection_tile_mercator_coords.x) / u_projection_tile_mercator_coords.z;
    }
    if (v_projection_tile_x < west || v_projection_tile_x >= east) {
        discard;
    }
}

// A tile's buffer holds geometry from beyond the tile, which the neighbouring tile's clipping mask hides on a flat map.
// The buffers of the top and bottom row lie under the tile's own pole cap, so line fragments beyond the tile's extent
// (0..8192) there are discarded, on the sides that u_projection_clip_antimeridian names: 2 for the top, 4 for the
// bottom. Past the edges of the world they are discarded as every layer's fragments are.
void clipAntimeridian() {
    clipWorldEdge();
    int sides = u_projection_clip_antimeridian;
    if ((sides & 2) != 0 && v_projection_tile_y < 0.0) {
        discard;
    }
    if ((sides & 4) != 0 && v_projection_tile_y >= 8192.0) {
        discard;
    }
}
