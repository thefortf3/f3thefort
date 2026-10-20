<?php
/**
 * Event tags (What's Hot, I2, Weekly…): a colour and a display order on the add/edit forms, and a
 * swatch in the list.
 *
 * @package FortWeekly
 */

defined( 'ABSPATH' ) || exit;

add_action(
	FORTW_TAX . '_add_form_fields',
	function () {
		?>
		<div class="form-field">
			<label for="fortw-color"><?php esc_html_e( 'Colour', 'fort-weekly' ); ?></label>
			<input type="color" id="fortw-color" name="fort_color" value="#9a9da5">
			<p><?php esc_html_e( 'Used for the tag’s chip on the site and in the newsletter.', 'fort-weekly' ); ?></p>
		</div>
		<div class="form-field">
			<label for="fortw-order"><?php esc_html_e( 'Order', 'fort-weekly' ); ?></label>
			<input type="number" id="fortw-order" name="fort_order" value="0" min="0" max="999">
			<p><?php esc_html_e( 'Lower numbers come first. An event shows its first tag.', 'fort-weekly' ); ?></p>
		</div>
		<?php
	}
);

add_action(
	FORTW_TAX . '_edit_form_fields',
	function ( $term ) {
		$color = get_term_meta( $term->term_id, 'fort_color', true );
		?>
		<tr class="form-field">
			<th scope="row"><label for="fortw-color"><?php esc_html_e( 'Colour', 'fort-weekly' ); ?></label></th>
			<td><input type="color" id="fortw-color" name="fort_color" value="<?php echo esc_attr( $color ? $color : '#9a9da5' ); ?>"></td>
		</tr>
		<tr class="form-field">
			<th scope="row"><label for="fortw-order"><?php esc_html_e( 'Order', 'fort-weekly' ); ?></label></th>
			<td><input type="number" id="fortw-order" name="fort_order" value="<?php echo (int) get_term_meta( $term->term_id, 'fort_order', true ); ?>" min="0" max="999">
				<p class="description"><?php esc_html_e( 'Lower numbers come first. An event shows its first tag.', 'fort-weekly' ); ?></p></td>
		</tr>
		<?php
	}
);

function fortw_save_tag_meta( $term_id ) {
	// WordPress has already checked the term form's nonce and the manage_fort_tags capability.
	if ( ! current_user_can( 'manage_fort_tags' ) ) {
		return;
	}
	// phpcs:disable WordPress.Security.NonceVerification.Missing
	if ( isset( $_POST['fort_color'] ) ) {
		$color = sanitize_hex_color( wp_unslash( $_POST['fort_color'] ) );
		update_term_meta( $term_id, 'fort_color', $color ? $color : '#9a9da5' );
	}
	if ( isset( $_POST['fort_order'] ) ) {
		update_term_meta( $term_id, 'fort_order', max( 0, min( 999, (int) $_POST['fort_order'] ) ) );
	}
	// phpcs:enable
}
add_action( 'created_' . FORTW_TAX, 'fortw_save_tag_meta' );
add_action( 'edited_' . FORTW_TAX, 'fortw_save_tag_meta' );

add_filter(
	'manage_edit-' . FORTW_TAX . '_columns',
	function ( $cols ) {
		unset( $cols['description'] );
		return array_slice( $cols, 0, 2, true ) + array( 'fortw_color' => __( 'Colour', 'fort-weekly' ), 'fortw_order' => __( 'Order', 'fort-weekly' ) ) + array_slice( $cols, 2, null, true );
	}
);

add_filter(
	'manage_' . FORTW_TAX . '_custom_column',
	function ( $out, $column, $term_id ) {
		if ( 'fortw_color' === $column ) {
			$c = get_term_meta( $term_id, 'fort_color', true );
			return sprintf( '<span class="fortw-tag" style="--c:%s">%s</span>', esc_attr( $c ? $c : '#9a9da5' ), esc_html( get_term( $term_id )->name ) );
		}
		if ( 'fortw_order' === $column ) {
			return (string) (int) get_term_meta( $term_id, 'fort_order', true );
		}
		return $out;
	},
	10,
	3
);
