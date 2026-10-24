<?php
/**
 * Where the theme's data comes from: events and region info from the Fort Weekly plugin, and
 * workouts, backblasts, the schedule and stats from the Fort Stats plugin (which reads Supabase
 * and keeps its own cache). Without a plugin, its parts of the site show as unavailable; the
 * theme never fetches data from anywhere itself.
 *
 * @package Fort
 */

defined( 'ABSPATH' ) || exit;

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

/** Recent workouts (backblasts), newest first. */
function fort_backblasts( $limit = 4 ) {
	return function_exists( 'fort_stats_backblasts' ) ? ( fort_stats_backblasts( 8, $limit )['items'] ?? array() ) : array();
}

/** Upcoming workouts from GloomSchedule: $days days from today (2 = today and tomorrow, up to 14). */
function fort_schedule( $days = 2 ) {
	if ( ! function_exists( 'fort_stats_schedule' ) ) {
		return null;
	}
	$data = fort_stats_schedule( $days );
	return empty( $data['configured'] ) ? null : $data;
}

/** Last week's totals, the 8-week trend and the busiest AOs. */
function fort_backblast_summary() {
	return function_exists( 'fort_stats_backblast_summary' ) ? fort_stats_backblast_summary() : null;
}

/** A page of the Backblasts archive. $args: page, ao, month (YYYY-MM), type, q. */
function fort_backblast_archive( $args ) {
	if ( ! function_exists( 'fort_stats_backblast_archive' ) ) {
		return null;
	}
	$query = array_filter(
		array(
			'page'     => max( 1, (int) ( $args['page'] ?? 1 ) ),
			'per_page' => 24,
			'ao'       => (string) ( $args['ao'] ?? '' ),
			'month'    => (string) ( $args['month'] ?? '' ),
			'type'     => (string) ( $args['type'] ?? '' ),
			'q'        => (string) ( $args['q'] ?? '' ),
		)
	);
	return fort_stats_backblast_archive( $query );
}

/** One backblast (full write-up, Qs, PAX), or null. */
function fort_backblast( $event_id ) {
	return function_exists( 'fort_stats_backblast' ) ? ( fort_stats_backblast( $event_id )['item'] ?? null ) : null;
}
