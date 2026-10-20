<?php
/**
 * Cached reads from the newsletter app's public API and the stats API.
 *
 * Every response is cached in a transient; the newsletter app can bump the cache version
 * through POST /wp-json/fort/v1/flush when an entry is approved or edited. The last good copy
 * of each response is also kept in an option, so the site keeps showing data if an API is
 * briefly unreachable.
 *
 * @package Fort
 */

defined( 'ABSPATH' ) || exit;

function fort_cache_version() {
	return (int) get_option( 'fort_cache_ver', 1 );
}

function fort_flush_cache() {
	update_option( 'fort_cache_ver', fort_cache_version() + 1, false );
}

/**
 * GET {$base}{$path} as decoded JSON (array), cached for $ttl seconds.
 * Returns null when the API can't be reached and nothing was cached before, and
 * array( '__missing' => true ) for a 404 (so callers can tell "not found" from "down").
 */
function fort_remote_json( $base, $path, $ttl ) {
	$id    = md5( $base . $path );
	$key   = 'fort_' . $id . '_' . fort_cache_version();
	$cached = get_transient( $key );
	if ( false !== $cached ) {
		return $cached;
	}

	$response = wp_remote_get(
		untrailingslashit( $base ) . $path,
		array(
			'timeout' => 6,
			'headers' => array( 'Accept' => 'application/json' ),
		)
	);

	if ( is_wp_error( $response ) ) {
		error_log( 'Fort theme: ' . $path . ' failed: ' . $response->get_error_message() );
		return get_option( 'fort_last_' . $id, null );
	}

	$code = (int) wp_remote_retrieve_response_code( $response );
	if ( 404 === $code ) {
		// Not cached: otherwise every made-up /events/<slug>/ URL would write a transient row.
		return array( '__missing' => true );
	}

	$data = json_decode( wp_remote_retrieve_body( $response ), true );
	if ( 200 !== $code || ! is_array( $data ) ) {
		error_log( 'Fort theme: ' . $path . ' returned HTTP ' . $code );
		return get_option( 'fort_last_' . $id, null );
	}

	set_transient( $key, $data, $ttl );
	update_option( 'fort_last_' . $id, $data, false );
	return $data;
}

function fort_is_missing( $data ) {
	return ! is_array( $data ) || ! empty( $data['__missing'] );
}

/** Homepage data: featured, this week, coming up, ongoing, region info. */
function fort_home() {
	$data = fort_remote_json( FORT_NL_API, '/api/public/home', FORT_API_TTL );
	return fort_is_missing( $data ) ? null : $data;
}

/** One entry page by slug: array( entry, same_day, related ) or null. */
function fort_entry( $slug ) {
	$data = fort_remote_json( FORT_NL_API, '/api/public/entries/' . rawurlencode( $slug ), FORT_API_TTL );
	return fort_is_missing( $data ) || empty( $data['entry'] ) ? null : $data;
}

/** Upcoming entries, optionally filtered by tag slug. */
function fort_entries( $args = array() ) {
	$query = $args ? '?' . http_build_query( $args ) : '';
	$data  = fort_remote_json( FORT_NL_API, '/api/public/entries' . $query, FORT_API_TTL );
	return fort_is_missing( $data ) ? array() : ( $data['items'] ?? array() );
}

/** Recent workouts (backblasts) from the stats API, newest first. */
function fort_backblasts( $limit = 4 ) {
	$data = fort_remote_json( FORT_STATS_API, '/api/backblasts?days=8&limit=' . (int) $limit, FORT_STATS_TTL );
	return fort_is_missing( $data ) ? array() : ( $data['items'] ?? array() );
}

/** Upcoming workouts from GloomSchedule (via the stats API): today and tomorrow. */
function fort_schedule() {
	$data = fort_remote_json( FORT_STATS_API, '/api/schedule?days=2', min( FORT_STATS_TTL, 900 ) );
	if ( fort_is_missing( $data ) || empty( $data['configured'] ) ) {
		return null;
	}
	return $data;
}

/** Last week's totals, the 8-week trend and the busiest AOs. */
function fort_backblast_summary() {
	$data = fort_remote_json( FORT_STATS_API, '/api/backblasts/summary', FORT_STATS_TTL );
	return fort_is_missing( $data ) ? null : $data;
}

/**
 * POST JSON to the newsletter app with the shared secret. Returns array( code, data ).
 */
function fort_nl_post_json( $path, $body, $client_ip ) {
	$response = wp_remote_post(
		untrailingslashit( FORT_NL_API ) . $path,
		array(
			'timeout' => 12,
			'headers' => array(
				'Content-Type'    => 'application/json',
				'X-Fort-Secret'   => FORT_NL_SECRET,
				'X-Fort-Client-IP' => $client_ip,
			),
			'body'    => wp_json_encode( $body ),
		)
	);
	if ( is_wp_error( $response ) ) {
		return array( 0, array( 'error' => $response->get_error_message() ) );
	}
	return array( (int) wp_remote_retrieve_response_code( $response ), json_decode( wp_remote_retrieve_body( $response ), true ) );
}

/**
 * Forward an uploaded image to the newsletter app. Returns its absolute URL or a WP_Error.
 */
function fort_nl_upload_image( $tmp_path, $filename, $mime, $client_ip ) {
	$boundary = wp_generate_password( 24, false );
	$body     = '--' . $boundary . "\r\n"
		. 'Content-Disposition: form-data; name="image"; filename="' . sanitize_file_name( $filename ) . "\"\r\n"
		. 'Content-Type: ' . $mime . "\r\n\r\n"
		. file_get_contents( $tmp_path ) . "\r\n" // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
		. '--' . $boundary . "--\r\n";
	$response = wp_remote_post(
		untrailingslashit( FORT_NL_API ) . '/api/public/upload',
		array(
			'timeout' => 30,
			'headers' => array(
				'Content-Type'    => 'multipart/form-data; boundary=' . $boundary,
				'X-Fort-Secret'   => FORT_NL_SECRET,
				'X-Fort-Client-IP' => $client_ip,
			),
			'body'    => $body,
		)
	);
	if ( is_wp_error( $response ) ) {
		return $response;
	}
	$data = json_decode( wp_remote_retrieve_body( $response ), true );
	if ( 200 !== (int) wp_remote_retrieve_response_code( $response ) || empty( $data['url'] ) ) {
		return new WP_Error( 'fort_upload', $data['error'] ?? __( 'The image could not be uploaded.', 'fort' ) );
	}
	return $data['url'];
}
