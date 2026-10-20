<?php
/**
 * Where the theme's data comes from: events and region info from the Fort Weekly plugin (in this
 * WordPress), and workouts, backblasts and stats from the stats API.
 *
 * Stats responses are cached in a transient; the last good copy of each is also kept in an
 * option, so the site keeps showing data if the stats API is briefly unreachable.
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

/** Homepage data: featured, this week, coming up, ongoing, region info. Null without the plugin. */
function fort_home() {
	static $home = false;
	if ( false === $home ) {
		$home = function_exists( 'fort_weekly_home' ) ? fort_weekly_home() : null;
	}
	return $home;
}

/** One event page: array( entry, same_day, related ) or null. $post: the event post (or its slug). */
function fort_entry( $post ) {
	return function_exists( 'fort_weekly_entry_page' ) ? fort_weekly_entry_page( $post ) : null;
}

/** Upcoming events, optionally filtered (tag, from, to, include_past, limit). */
function fort_entries( $args = array() ) {
	return function_exists( 'fort_weekly_entries' ) ? fort_weekly_entries( $args ) : array();
}

/** Recent workouts (backblasts) from the stats API, newest first. */
function fort_backblasts( $limit = 4 ) {
	$data = fort_remote_json( FORT_STATS_API, '/api/backblasts?days=8&limit=' . (int) $limit, FORT_STATS_TTL );
	return fort_is_missing( $data ) ? array() : ( $data['items'] ?? array() );
}

/** Upcoming workouts from GloomSchedule (via the stats API): $days days from today (2 = today and tomorrow, up to 14). */
function fort_schedule( $days = 2 ) {
	$data = fort_remote_json( FORT_STATS_API, '/api/schedule?days=' . max( 1, min( 14, (int) $days ) ), min( FORT_STATS_TTL, 900 ) );
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
