// Under mercator projection tile buffer geometry never wraps around the planet,
// so no fragments need to be discarded. See _projection_globe.fragment.glsl.
void clipAntimeridian() {
}

// The mercator plane has no edge of the world that a tile could cross. See _projection_equal_earth.fragment.glsl.
void clipWorldEdge() {
}
