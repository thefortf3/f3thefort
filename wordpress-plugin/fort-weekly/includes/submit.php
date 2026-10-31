<?php
/**
 * The PAX "Submit an event" form handler (the theme's /submit/ page posts here as action
 * fort_submit). Everything lands as a pending event for an editor to approve; nothing is
 * published from here.
 *
 * Abuse limits: nonce + honeypot, 6 submissions an hour per visitor (10 edits an hour per event)
 * and 60 an hour in total,
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
const FORTW_EDITS_PER_EVENT_HOUR = 10;
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
	$description = fortw_submission_html( isset( $_POST['description'] ) ? (string) wp_unslash( $_POST['description'] ) : '' ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput -- cleaned by fortw_submission_html
	$errors      = array();
	if ( '' === $title ) {
		$errors[] = 'title';
	}
	if ( null === $description ) {
		fortw_submit_redirect( array( 'fort_error' => 'long' ) );
	}
	if ( fortw_html_is_empty( $description ) ) {
		$errors[] = 'description';
	}
	if ( '' !== $date && ! fortw_is_iso_date( $date ) ) {
		$errors[] = 'date';
	}
	if ( $errors ) {
		fortw_submit_redirect( array( 'fort_error' => 'missing', 'fields' => implode( ',', $errors ) ) );
	}

	// An edit of an existing event (its private edit link)?
	$edit_param = isset( $_POST['fort_edit'] ) ? sanitize_text_field( wp_unslash( $_POST['fort_edit'] ) ) : '';
	$event      = null;
	if ( '' !== $edit_param ) {
		$event = fortw_edit_target( $edit_param );
		if ( is_wp_error( $event ) ) {
			fortw_submit_redirect( array( 'fort_error' => 'link' ) );
		}
	}

	// New submissions are limited per visitor; edits per event (so fixing a typo doesn't use up
	// anyone's allowance). Both count toward the overall hourly limit.
	$slot = $event
		? fortw_take_slot( 'fortw_edit_' . $event->ID, FORTW_EDITS_PER_EVENT_HOUR )
		: fortw_take_slot( 'fortw_sub_' . md5( fortw_client_ip() ), FORTW_SUBMIT_PER_IP_HOUR );
	if ( ! $slot || ! fortw_take_slot( 'fortw_sub_all', FORTW_SUBMIT_TOTAL_HOUR ) ) {
		fortw_submit_redirect( array( 'fort_error' => 'busy' ) );
	}

	$has_flyer = ! empty( $_FILES['flyer']['tmp_name'] ) && UPLOAD_ERR_NO_FILE !== (int) ( $_FILES['flyer']['error'] ?? UPLOAD_ERR_NO_FILE ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
	if ( $has_flyer && ! fortw_flyer_ok( $_FILES['flyer'] ) ) { // phpcs:ignore WordPress.Security.ValidatedSanitizedInput -- checked in fortw_flyer_ok
		fortw_submit_redirect( array( 'fort_error' => 'image' ) );
	}

	if ( $event ) {
		fortw_handle_submitter_edit( $event, $field, $title, $date, $description, $has_flyer );
	}

	$post_id = wp_insert_post(
		array(
			'post_type'    => FORTW_POST_TYPE,
			'post_status'  => 'pending',
			'post_title'   => $title,
			'post_content' => $description,
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
	fortw_email_submitter( $post_id, 'received' ); // "We got your event", with the private edit link.
	fortw_submit_redirect( array( 'submitted' => '1', 'fort_link' => fortw_edit_param( $post_id ) ) );
}

/** The form came in through an edit link: save it as an edit of $event (see edits.php). */
function fortw_handle_submitter_edit( $event, $field, $title, $date, $description, $has_flyer ) {
	// phpcs:disable WordPress.Security.NonceVerification.Missing -- verified in fortw_handle_submission
	$meta = array(
		'_fort_leader'          => $field( 'leader', 120 ),
		'_fort_location'        => $field( 'location', 200 ),
		'_fort_link'            => isset( $_POST['link'] ) ? fortw_http_url( wp_unslash( $_POST['link'] ) ) : '', // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
		'_fort_submitter_name'  => $field( 'submitter_name', 120 ),
		'_fort_submitter_email' => sanitize_email( $field( 'submitter_email', 200 ) ),
		'_fort_submitter_phone' => $field( 'submitter_phone', 40 ),
	);
	// Events with several dates (set by an editor) keep their dates; the form only edits one.
	$occ = null;
	if ( count( fortw_get_occurrences( $event->ID ) ) <= 1 ) {
		$occ = $date ? array( array( 'date' => $date, 'start_time' => $field( 'start_time', 40 ), 'end_time' => $field( 'end_time', 40 ) ) ) : array();
	}
	$flyer = ! empty( $_POST['remove_flyer'] ) ? 'remove' : 'keep';
	// phpcs:enable
	$target = fortw_save_submitter_edit( $event, array( 'title' => $title, 'content' => $description, 'meta' => $meta, 'occurrences' => $occ, 'flyer' => $flyer ) );
	if ( $has_flyer ) {
		$attachment = fortw_store_flyer( $target );
		if ( is_wp_error( $attachment ) ) {
			error_log( 'Fort Weekly: flyer upload failed: ' . $attachment->get_error_message() );
		} else {
			set_post_thumbnail( $target, $attachment );
		}
	}
	fortw_notify_submitter_edit( $event->ID, $target !== $event->ID );
	fortw_submit_redirect( array( 'submitted' => '1', 'changed' => $target !== $event->ID ? 'live' : 'pending', 'fort_link' => fortw_edit_param( $event->ID ) ) );
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

/** What a submitted description may contain: the editor's bold, italic, lists and links. */
function fortw_submission_tags() {
	return array(
		'p'      => array(),
		'br'     => array(),
		'strong' => array(),
		'b'      => array(),
		'em'     => array(),
		'i'      => array(),
		'ul'     => array(),
		'ol'     => array(),
		'li'     => array(),
		'a'      => array( 'href' => true ),
	);
}

/**
 * A submitted description, cleaned for storing: from the form's editor (a little HTML) or, without
 * JavaScript, plain text. Anything beyond fortw_submission_tags() is removed, links may only be
 * http(s) or mailto and get rel="nofollow", and paragraphs are added the way WordPress displays
 * posts. Returns null when it is too long (over 8,000 characters of text).
 */
function fortw_submission_html( $raw ) {
	$raw = str_replace( "\r\n", "\n", (string) $raw );
	if ( mb_strlen( $raw ) > 40000 ) {
		return null;
	}
	if ( preg_match( '/<[a-z\/!]/i', $raw ) ) {
		$html = preg_replace( '#<(script|style|iframe|object|noscript)\b[^>]*>.*?</\1\s*>#is', '', $raw ); // Drop their contents too.
		$html = wp_kses( $html, fortw_submission_tags(), array( 'http', 'https', 'mailto' ) );
		// A link whose address isn't http(s) or mailto (kses leaves e.g. "alert(1)") keeps only its text.
		$html = preg_replace( '#<a\s+href="(?!https?://|mailto:)[^"]*"[^>]*>(.*?)</a>#is', '$1', $html );
		$html = wp_unslash( wp_rel_nofollow( wp_slash( $html ) ) );
	} else {
		$html = esc_html( sanitize_textarea_field( $raw ) );
	}
	if ( mb_strlen( trim( html_entity_decode( wp_strip_all_tags( $html ) ) ) ) > 8000 ) {
		return null;
	}
	return trim( wpautop( $html ) );
}

/** True when HTML has no visible text (tags, spaces and non-breaking spaces only). */
function fortw_html_is_empty( $html ) {
	return '' === trim( str_replace( "\xC2\xA0", ' ', html_entity_decode( wp_strip_all_tags( (string) $html ), ENT_QUOTES, 'UTF-8' ) ) );
}

