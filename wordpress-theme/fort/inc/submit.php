<?php
/**
 * "Submit an event" form handler. Validates on the WordPress side, then forwards to the
 * newsletter app (POST /api/public/submissions) with the shared secret. Everything lands in
 * the approval queue; nothing is published from here.
 *
 * @package Fort
 */

defined( 'ABSPATH' ) || exit;

add_action( 'admin_post_nopriv_fort_submit', 'fort_handle_submit' );
add_action( 'admin_post_fort_submit', 'fort_handle_submit' );

function fort_submit_redirect( $args ) {
	wp_safe_redirect( add_query_arg( $args, fort_submit_url() ) . '#submit-result' );
	exit;
}

function fort_client_ip() {
	return isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : '';
}

function fort_handle_submit() {
	if ( ! isset( $_POST['fort_nonce'] ) || ! wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST['fort_nonce'] ) ), 'fort_submit' ) ) {
		fort_submit_redirect( array( 'error' => 'expired' ) );
	}
	// Honeypot: real people never fill this hidden field. Pretend it worked.
	if ( ! empty( $_POST['website'] ) ) {
		fort_submit_redirect( array( 'submitted' => '1' ) );
	}
	if ( '' === FORT_NL_SECRET ) {
		fort_submit_redirect( array( 'error' => 'disabled' ) );
	}

	// Light per-visitor throttle on top of the app's own rate limit.
	$ip       = fort_client_ip();
	$throttle = 'fort_sub_' . md5( $ip );
	$count    = (int) get_transient( $throttle );
	if ( $count >= 6 ) {
		fort_submit_redirect( array( 'error' => 'busy' ) );
	}
	set_transient( $throttle, $count + 1, HOUR_IN_SECONDS );

	$field = function ( $name, $max = 200 ) {
		return isset( $_POST[ $name ] ) ? mb_substr( sanitize_text_field( wp_unslash( $_POST[ $name ] ) ), 0, $max ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Missing -- verified above
	};
	$title       = $field( 'title', 160 );
	$date        = $field( 'start_date', 10 );
	$description = isset( $_POST['description'] ) ? sanitize_textarea_field( wp_unslash( $_POST['description'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Missing

	$errors = array();
	if ( '' === $title ) {
		$errors[] = 'title';
	}
	if ( '' === trim( $description ) ) {
		$errors[] = 'description';
	}
	if ( '' !== $date && ! preg_match( '/^\d{4}-\d{2}-\d{2}$/', $date ) ) {
		$errors[] = 'date';
	}
	$link = isset( $_POST['link'] ) ? esc_url_raw( wp_unslash( $_POST['link'] ), array( 'http', 'https' ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Missing
	if ( $errors ) {
		fort_submit_redirect( array( 'error' => 'missing', 'fields' => implode( ',', $errors ) ) );
	}

	$hero = '';
	if ( ! empty( $_FILES['flyer']['tmp_name'] ) && UPLOAD_ERR_OK === (int) $_FILES['flyer']['error'] ) { // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
		$tmp  = $_FILES['flyer']['tmp_name']; // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
		$name = sanitize_file_name( wp_unslash( $_FILES['flyer']['name'] ?? 'flyer' ) ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
		$type = wp_check_filetype_and_ext( $tmp, $name );
		if ( empty( $type['type'] ) || 0 !== strpos( $type['type'], 'image/' ) || filesize( $tmp ) > 5 * MB_IN_BYTES ) {
			fort_submit_redirect( array( 'error' => 'image' ) );
		}
		$hero = fort_nl_upload_image( $tmp, $name, $type['type'], $ip );
		if ( is_wp_error( $hero ) ) {
			fort_submit_redirect( array( 'error' => 'image' ) );
		}
	}

	list( $code ) = fort_nl_post_json(
		'/api/public/submissions',
		array(
			'title'           => $title,
			'leader'          => $field( 'leader', 120 ),
			'start_date'      => $date,
			'start_time'      => $field( 'start_time', 40 ),
			'end_time'        => $field( 'end_time', 40 ),
			'location'        => $field( 'location', 200 ),
			// Plain text from the form → simple paragraphs; the app sanitizes again.
			'description'     => wpautop( esc_html( $description ) ),
			'link'            => $link,
			'hero_image'      => $hero,
			'submitter_name'  => $field( 'submitter_name', 120 ),
			'submitter_email' => sanitize_email( wp_unslash( $_POST['submitter_email'] ?? '' ) ), // phpcs:ignore WordPress.Security.NonceVerification.Missing
			'submitter_phone' => $field( 'submitter_phone', 40 ),
		),
		$ip
	);

	if ( 201 === $code ) {
		fort_submit_redirect( array( 'submitted' => '1' ) );
	}
	fort_submit_redirect( array( 'error' => 429 === $code ? 'busy' : 'failed' ) );
}
