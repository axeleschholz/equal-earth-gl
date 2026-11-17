in highp float v_projection_tile_x;
in highp float v_projection_tile_y;

// A tile's buffer holds geometry from beyond the tile, which the neighbouring tile's clipping mask hides on a flat map.
// At the edges of the world there is no neighbour: the buffers of the first and last column reach past the antimeridian,
// where their content is drawn on the edge of the world, and those of the top and bottom row lie under the tile's own
// pole cap. So fragments beyond the tile's extent (0..8192) on the sides that u_projection_clip_antimeridian names are
// discarded: 1 for both sides in x, 2 for the top, 4 for the bottom.
void clipAntimeridian() {
    int sides = u_projection_clip_antimeridian;
    if ((sides & 1) != 0 && (v_projection_tile_x < 0.0 || v_projection_tile_x >= 8192.0)) {
        discard;
    }
    if ((sides & 2) != 0 && v_projection_tile_y < 0.0) {
        discard;
    }
    if ((sides & 4) != 0 && v_projection_tile_y >= 8192.0) {
        discard;
    }
}
