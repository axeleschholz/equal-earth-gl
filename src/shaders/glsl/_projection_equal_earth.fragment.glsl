in highp float v_projection_tile_x;

// The buffers of the tiles in the first and last column reach past the antimeridian, where the world ends.
// What they hold is drawn on the edge of the world, so fragments beyond the tile's X extent (0..8192) are
// discarded when enabled for the tile.
void clipAntimeridian() {
    if (u_projection_clip_antimeridian != 0 && (v_projection_tile_x < 0.0 || v_projection_tile_x >= 8192.0)) {
        discard;
    }
}
