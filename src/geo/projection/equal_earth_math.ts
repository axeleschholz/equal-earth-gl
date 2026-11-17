const A1 = 1.340264;
const A2 = -0.081106;
const A3 = 0.000893;
const A4 = 0.003796;
const M = Math.sqrt(3) / 2;

/** Semi-major axis of the WGS84 ellipsoid, in metres. */
const WGS84_A = 6378137;
/** First eccentricity squared of the WGS84 ellipsoid. */
const WGS84_E2 = 0.00669437999014;
const WGS84_E = Math.sqrt(WGS84_E2);

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/**
 * How far past the outline, as a fraction of its size, a position may be and still count as on it, so that
 * the forward of a position on the outline has an inverse despite rounding.
 */
const OUTLINE_TOLERANCE = 1e-12;

/**
 * The authalic function `q` of a geodetic latitude's sine: the area of the ellipsoid between the equator and
 * that latitude is proportional to it.
 */
function authalicQ(sinPhi: number): number {
    const eSin = WGS84_E * sinPhi;
    return (1 - WGS84_E2) * (sinPhi / (1 - eSin * eSin) - Math.log((1 - eSin) / (1 + eSin)) / (2 * WGS84_E));
}

/** The derivative of {@link authalicQ} by geodetic latitude, in radians. */
function authalicQDerivative(sinPhi: number, cosPhi: number): number {
    const w2 = 1 - WGS84_E2 * sinPhi * sinPhi;
    return (1 - WGS84_E2) * 2 * cosPhi / (w2 * w2);
}

const Q_POLE = authalicQ(1);

/** Radius of the sphere with the surface area of the WGS84 ellipsoid, in metres: 6371007.1809. */
const AUTHALIC_RADIUS = WGS84_A * Math.sqrt(Q_POLE / 2);

/** The derivative of `y / R` by the parametric latitude θ, which is also the denominator of `x`. */
function yDerivative(theta: number): number {
    const t2 = theta * theta;
    const t6 = t2 * t2 * t2;
    return A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2);
}

/** `y / R` at the parametric latitude θ. */
function yOfTheta(theta: number): number {
    const t2 = theta * theta;
    const t6 = t2 * t2 * t2;
    return theta * (A1 + A2 * t2 + t6 * (A3 + A4 * t2));
}

const THETA_POLE = Math.asin(M);

/** The `x` of the antimeridian on the equator, in metres: half the width of the Equal Earth world. */
export const EQUAL_EARTH_HALF_WIDTH: number = AUTHALIC_RADIUS * Math.PI / (M * A1);

/** The `y` of the north pole, in metres: half the height of the Equal Earth world. */
export const EQUAL_EARTH_HALF_HEIGHT: number = AUTHALIC_RADIUS * yOfTheta(THETA_POLE);

/**
 * Projects lng/lat in degrees to Equal Earth metres on the WGS84 ellipsoid, the coordinates of EPSG:8857
 * (Šavrič, Patterson and Jenny, 2018, with the geodetic latitude taken to the authalic one first).
 * Positions are not clamped or wrapped: a longitude past ±180 lands past the edge of the world.
 *
 * @param out - the array the result is written to; a new one when omitted
 */
export function equalEarthForward(lng: number, lat: number, out: [number, number] = [0, 0]): [number, number] {
    const sinBeta = Math.max(-1, Math.min(1, authalicQ(Math.sin(lat * DEG_TO_RAD)) / Q_POLE));
    const theta = Math.asin(M * sinBeta);
    out[0] = AUTHALIC_RADIUS * lng * DEG_TO_RAD * Math.cos(theta) / (M * yDerivative(theta));
    out[1] = AUTHALIC_RADIUS * yOfTheta(theta);
    return out;
}

/**
 * The geodetic latitude, in radians, whose authalic latitude has the given sine: a series for a first value
 * and Newton steps on {@link authalicQ} to refine it, which the poles, where the derivative vanishes, skip.
 */
function geodeticFromAuthalicSine(sinBeta: number): number {
    if (sinBeta >= 1) return Math.PI / 2;
    if (sinBeta <= -1) return -Math.PI / 2;
    const beta = Math.asin(sinBeta);
    const e4 = WGS84_E2 * WGS84_E2;
    const e6 = e4 * WGS84_E2;
    let phi = beta +
        (WGS84_E2 / 3 + 31 * e4 / 180 + 517 * e6 / 5040) * Math.sin(2 * beta) +
        (23 * e4 / 360 + 251 * e6 / 3780) * Math.sin(4 * beta) +
        (761 * e6 / 45360) * Math.sin(6 * beta);
    const q = Q_POLE * sinBeta;
    for (let i = 0; i < 3; i++) {
        const sinPhi = Math.sin(phi);
        const cosPhi = Math.cos(phi);
        if (cosPhi < 1e-7) break;
        phi += (q - authalicQ(sinPhi)) / authalicQDerivative(sinPhi, cosPhi);
    }
    return Math.max(-Math.PI / 2, Math.min(Math.PI / 2, phi));
}

/**
 * Takes Equal Earth metres (EPSG:8857) back to lng/lat in degrees.
 *
 * @param out - the array the result is written to; a new one when omitted
 * @returns the position, or `null` for a point outside the outline of the world or one that is not finite
 */
export function equalEarthInverse(x: number, y: number, out: [number, number] = [0, 0]): [number, number] | null {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (Math.abs(y) > EQUAL_EARTH_HALF_HEIGHT * (1 + OUTLINE_TOLERANCE)) return null;
    const target = y / AUTHALIC_RADIUS;
    let theta = target / A1;
    for (let i = 0; i < 12; i++) {
        const delta = (yOfTheta(theta) - target) / yDerivative(theta);
        theta -= delta;
        if (Math.abs(delta) < 1e-14) break;
    }
    theta = Math.max(-THETA_POLE, Math.min(THETA_POLE, theta));
    const lambda = M * x * yDerivative(theta) / (AUTHALIC_RADIUS * Math.cos(theta));
    if (Math.abs(lambda) > Math.PI * (1 + OUTLINE_TOLERANCE)) return null;
    out[0] = Math.max(-180, Math.min(180, lambda * RAD_TO_DEG));
    out[1] = geodeticFromAuthalicSine(Math.sin(theta) / M) * RAD_TO_DEG;
    return out;
}

/**
 * The partial derivatives of {@link equalEarthForward} at a position, in metres per degree:
 * `[dx/dlng, dx/dlat, dy/dlng, dy/dlat]`. Their determinant is the area of the ellipsoid per square degree
 * at that latitude, which is what makes the projection equal-area.
 */
export function equalEarthJacobian(lng: number, lat: number): [number, number, number, number] {
    const phi = lat * DEG_TO_RAD;
    const sinPhi = Math.sin(phi);
    const sinBeta = Math.max(-1, Math.min(1, authalicQ(sinPhi) / Q_POLE));
    const theta = Math.asin(M * sinBeta);
    const cosTheta = Math.cos(theta);
    const d = yDerivative(theta);
    const t2 = theta * theta;
    const dPrime = 6 * A2 * theta + t2 * t2 * theta * (42 * A3 + 72 * A4 * t2);
    const thetaByPhi = M * authalicQDerivative(sinPhi, Math.cos(phi)) / (Q_POLE * cosTheta);
    const xByTheta = AUTHALIC_RADIUS * lng * DEG_TO_RAD * (-Math.sin(theta) * d - cosTheta * dPrime) / (M * d * d);
    return [
        AUTHALIC_RADIUS * cosTheta / (M * d) * DEG_TO_RAD,
        xByTheta * thetaByPhi * DEG_TO_RAD,
        0,
        AUTHALIC_RADIUS * d * thetaByPhi * DEG_TO_RAD,
    ];
}
