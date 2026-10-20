<?php
/**
 * The PAX "Submit an event" form handler (the theme's /submit/ page posts here as action
 * fort_submit). Everything lands as a pending event for an editor to approve; nothing is
 * published from here.
 *
 * Abuse limits: nonce + honeypot, 6 submissions an hour per visitor and 60 an hour in total,
 * field length caps, and a flyer that must really be a JPG/PNG/GIF/WebP under 5 MB.
 *
 * Behind a reverse proxy or CDN, define FORT_CLIENT_IP_HEADER in wp-config.php (for example
 * 'HTTP_CF_CONNECTING_IP' or 'HTTP_X_REAL_IP') so the per-visitor limit sees real visitors.
 *
 * @package FortWeekly
 */

defined( 'ABSPATH' ) || exit;

const FORTW_SUBMIT_PER_IP_HOUR = 6;
const FORTW_SUBMIT_TOTAL_HOUR  = 60;
const FORTW_FLYER_MAX_BYTES    = 5242880; // 5 MB.

add_action( 'admin_post_nopriv_fort_submit', 'fortw_handle_submission' );
add_action( 'admin_post_fort_submit', 'fortw_handle_submission' );

function fortw_client_ip() {
	$key = defined( 'FORT_CLIENT_IP_HEADER' ) && FORT_CLIENT_IP_HEADER ? FORT_CLIENT_IP_HEADER : 'REMOTE_ADDR';
	$raw = isset( $_SERVER[ $key ] ) ? (string) wp_unslash( $_SERVER[ $key ] ) : ''; // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
	$ip  = trim( explode( ',', $raw )[0] );
	return filter_var( $ip, FILTER_VALIDATE_IP ) ? $ip : ( isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : '' );
}

function fortw_submit_redirect( $args ) {
	$page = function_exists( 'fort_submit_url' ) ? fort_submit_url() : home_url( '/submit/' );
	wp_safe_redirect( add_query_arg( $args, $page ) . '#submit-result' );
	exit;
}

/** Counts a submission against an hourly limit; false once the limit is reached. */
function fortw_take_slot( $key, $limit ) {
	$count = (int) get_transient( $key );
	if ( $count >= $limit ) {
		return false;
	}
	set_transient( $key, $count + 1, HOUR_IN_SECONDS );
	return true;
}

function fortw_handle_submission() {
	// phpcs:disable WordPress.Security.NonceVerification.Missing -- verified first thing
	if ( ! isset( $_POST['fort_nonce'] ) || ! wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST['fort_nonce'] ) ), 'fort_submit' ) ) {
		fortw_submit_redirect( array( 'fort_error' => 'expired' ) );
	}
	// Honeypot: people never fill this hidden field. Pretend it worked.
	if ( ! empty( $_POST['website'] ) ) {
		fortw_submit_redirect( array( 'submitted' => '1' ) );
	}

	$field = function ( $name, $max ) {
		return isset( $_POST[ $name ] ) ? mb_substr( sanitize_text_field( wp_unslash( $_POST[ $name ] ) ), 0, $max ) : '';
	};
	$title       = $field( 'title', 160 );
	$date        = $field( 'start_date', 10 );
	$description = isset( $_POST['description'] ) ? mb_substr( sanitize_textarea_field( wp_unslash( $_POST['description'] ) ), 0, 8000 ) : '';
	$errors      = array();
	if ( '' === $title ) {
		$errors[] = 'title';
	}
	if ( '' === trim( $description ) ) {
		$errors[] = 'description';
	}
	if ( '' !== $date && ! fortw_is_iso_date( $date ) ) {
		$errors[] = 'date';
	}
	if ( $errors ) {
		fortw_submit_redirect( array( 'fort_error' => 'missing', 'fields' => implode( ',', $errors ) ) );
	}

	$ip = fortw_client_ip();
	if ( ! fortw_take_slot( 'fortw_sub_' . md5( $ip ), FORTW_SUBMIT_PER_IP_HOUR ) || ! fortw_take_slot( 'fortw_sub_all', FORTW_SUBMIT_TOTAL_HOUR ) ) {
		fortw_submit_redirect( array( 'fort_error' => 'busy' ) );
	}

	$has_flyer = ! empty( $_FILES['flyer']['tmp_name'] ) && UPLOAD_ERR_NO_FILE !== (int) ( $_FILES['flyer']['error'] ?? UPLOAD_ERR_NO_FILE ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
	if ( $has_flyer && ! fortw_flyer_ok( $_FILES['flyer'] ) ) { // phpcs:ignore WordPress.Security.ValidatedSanitizedInput -- checked in fortw_flyer_ok
		fortw_submit_redirect( array( 'fort_error' => 'image' ) );
	}

	$post_id = wp_insert_post(
		array(
			'post_type'    => FORTW_POST_TYPE,
			'post_status'  => 'pending',
			'post_title'   => $title,
			'post_content' => wpautop( esc_html( $description ) ), // Plain text from the form → paragraphs.
			'post_author'  => 0,
		),
		true
	);
	if ( is_wp_error( $post_id ) ) {
		error_log( 'Fort Weekly: submission failed: ' . $post_id->get_error_message() );
		fortw_submit_redirect( array( 'fort_error' => 'failed' ) );
	}

	$link = isset( $_POST['link'] ) ? fortw_http_url( wp_unslash( $_POST['link'] ) ) : ''; // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
	$meta = array(
		'_fort_leader'          => $field( 'leader', 120 ),
		'_fort_location'        => $field( 'location', 200 ),
		'_fort_link'            => $link,
		'_fort_submitter_name'  => $field( 'submitter_name', 120 ),
		'_fort_submitter_email' => sanitize_email( $field( 'submitter_email', 200 ) ),
		'_fort_submitter_phone' => $field( 'submitter_phone', 40 ),
		'_fort_origin'          => 'form',
	);
	foreach ( $meta as $key => $value ) {
		if ( '' !== $value ) {
			update_post_meta( $post_id, $key, $value );
		}
	}
	$occ = $date ? array( array( 'date' => $date, 'start_time' => $field( 'start_time', 40 ), 'end_time' => $field( 'end_time', 40 ) ) ) : array();
	fortw_set_occurrences( $post_id, $occ );
	// phpcs:enable

	if ( $has_flyer ) {
		$attachment = fortw_store_flyer( $post_id );
		if ( is_wp_error( $attachment ) ) {
			// Keep the event; the editor can add a flyer. Say so to the submitter.
			error_log( 'Fort Weekly: flyer upload failed: ' . $attachment->get_error_message() );
		} else {
			set_post_thumbnail( $post_id, $attachment );
		}
	}

	fortw_notify_new_submission( $post_id );
	fortw_submit_redirect( array( 'submitted' => '1' ) );
}

/** The allowed flyer types, by extension. */
function fortw_flyer_mimes() {
	return array( 'jpg|jpeg|jpe' => 'image/jpeg', 'png' => 'image/png', 'gif' => 'image/gif', 'webp' => 'image/webp' );
}

/** True if the upload is really one of the allowed image types (checked from its contents) and small enough. */
function fortw_flyer_ok( $file ) {
	if ( UPLOAD_ERR_OK !== (int) $file['error'] || ! is_uploaded_file( $file['tmp_name'] ) || (int) $file['size'] > FORTW_FLYER_MAX_BYTES ) {
		return false;
	}
	$check = wp_check_filetype_and_ext( $file['tmp_name'], sanitize_file_name( $file['name'] ), fortw_flyer_mimes() );
	if ( empty( $check['type'] ) || ! in_array( $check['type'], fortw_flyer_mimes(), true ) ) {
		return false;
	}
	// Belt and braces: the file must decode as an image.
	return false !== @getimagesize( $file['tmp_name'] ); // phpcs:ignore WordPress.PHP.NoSilencedErrors
}

/** Saves the flyer into the media library under a random name, attached to the event. */
function fortw_store_flyer( $post_id ) {
	require_once ABSPATH . 'wp-admin/includes/file.php';
	require_once ABSPATH . 'wp-admin/includes/media.php';
	require_once ABSPATH . 'wp-admin/includes/image.php';
	$check = wp_check_filetype_and_ext( $_FILES['flyer']['tmp_name'], sanitize_file_name( $_FILES['flyer']['name'] ), fortw_flyer_mimes() ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
	// A random name, so pending flyers can't be found by guessing URLs.
	$_FILES['flyer']['name'] = 'flyer-' . strtolower( wp_generate_password( 12, false ) ) . '.' . $check['ext'];
	return media_handle_upload(
		'flyer',
		$post_id,
		array( 'post_title' => get_the_title( $post_id ) ),
		array( 'test_form' => false, 'mimes' => fortw_flyer_mimes() )
	);
}
