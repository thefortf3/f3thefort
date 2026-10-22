<?php
/**
 * Background refresh: the data every page shows (the Q schedule, the backblast feed and last
 * week's summary, the dashboard, streaks, the FNG sheet) is fetched from GloomSchedule, Supabase
 * and Google by a WordPress background job, never while a page is being built. Pages read the
 * stored copy. When a copy is older than it should be, reading it asks for a refresh (in the
 * background) and still returns the copy.
 *
 * The job runs every 10 minutes and refreshes what's due: the schedule, dashboard, streaks and FNGs
 * every hour (FORT_STATS_CACHE_TTL), the backblast feed, summary and first Backblasts page every 15
 * minutes. It also runs right after activation and from Settings → Fort
 * Stats → "Refresh now".
 *
 * WP-Cron runs on visits. For a steady 10 minutes whatever the traffic, add a real cron job on the
 * host and set DISABLE_WP_CRON (see README.md).
 *
 * @package FortStats
 */

defined( 'ABSPATH' ) || exit;

/**
 * The background jobs, in the order they run (the FNG sheet first: others use it):
 * key => array( seconds between refreshes, builder ). Builders may throw FStats_Unavailable.
 */
function fstats_jobs() {
	return array(
		'fng_sheet'     => array( fstats_ttl(), fn() => fstats_fng_records() ),
		// The Q schedule: 14 days, hourly. Pages cut what they need from it.
		'schedule'      => array( fstats_ttl(), fn() => fstats_build_schedule( 14 ) ),
		// 31 days of backblasts; smaller feeds are cut from it.
		'bb_feed'       => array( fstats_ttl( 0.25 ), fn() => fstats_build( fn( $db ) => fstats_backblasts_payload( $db, 31, 50 ) ) ),
		'bb_summary'    => array( fstats_ttl( 0.25 ), fn() => fstats_build( fn( $db ) => fstats_backblast_summary_payload( $db ) ) ),
		// The Backblasts page as it first opens (page 1, no filters).
		'bb_archive_1'  => array( fstats_ttl( 0.25 ), fn() => fstats_build( fn( $db ) => fstats_backblast_archive_payload( $db, 1, 24 ) ) ),
		'core'          => array( fstats_ttl(), fn() => fstats_build( fn( $db ) => fstats_core_payload( $db ) ) ),
		'streaks'       => array( fstats_ttl(), fn() => fstats_build( fn( $db ) => fstats_streaks_payload( $db ) ) ),
		'fng'           => array( fstats_ttl(), fn() => fstats_fng_payload( fstats_kept_records() ) ),
		'fng_challenge' => array( fstats_ttl(), fn() => fstats_build( fn( $db ) => fstats_fng_challenge_payload( $db, fstats_kept_records(), fstats_setting( 'fng_start' ) ?: '2026-09-01', fstats_setting( 'fng_end' ) ?: '2026-09-30' ) ) ),
	);
}

/** $days of the Q schedule from today, the days fetched in parallel. */
function fstats_build_schedule( $days ) {
	$gs = FStats_GloomSchedule::from_config();
	if ( $gs ) {
		$today = fstats_region_today();
		$gs->prefetch( array_map( fn( $n ) => fstats_add_days( $today, $n ), range( 0, $days - 1 ) ) );
	}
	return fstats_schedule_payload( $gs, $days );
}

/** The FNG sheet's stored records, for builders; throws when it has never been read. */
function fstats_kept_records() {
	$records = fstats_kept( 'fng_sheet' );
	if ( null === $records ) {
		throw new FStats_Unavailable( 'FNG sheet not read yet' );
	}
	return $records;
}

/**
 * A job's stored data, or null if it has never been fetched. Never fetches: a missing or old
 * copy asks for a background refresh.
 */
function fstats_kept( $key ) {
	$jobs  = fstats_jobs();
	$entry = get_option( 'fstats_kept_' . $key );
	if ( ! is_array( $entry ) || time() - (int) $entry['t'] >= (int) ( $jobs[ $key ][0] ?? HOUR_IN_SECONDS ) ) {
		fstats_request_refresh();
	}
	return is_array( $entry ) ? $entry['data'] : null;
}

/** When a job's data was last fetched (Unix time), or 0. */
function fstats_kept_at( $key ) {
	$entry = get_option( 'fstats_kept_' . $key );
	return is_array( $entry ) ? (int) $entry['t'] : 0;
}

/** Asks for a background refresh (once; WP-Cron runs it after this request, without waiting). */
function fstats_request_refresh() {
	static $asked = false;
	if ( $asked || wp_next_scheduled( 'fstats_refresh' ) || get_transient( 'fstats_refresh_running' ) ) {
		return;
	}
	$asked = true;
	wp_schedule_single_event( time(), 'fstats_refresh' );
}

/**
 * Fetches every job that's due (or all, with $force) and stores it. A job that fails keeps its old
 * copy. Returns array( key => 'ok' | 'kept' (not due) | error message ).
 */
function fstats_refresh( $force = false ) {
	if ( ! $force && get_transient( 'fstats_refresh_running' ) ) {
		return array();
	}
	set_transient( 'fstats_refresh_running', 1, 10 * MINUTE_IN_SECONDS );
	@set_time_limit( 120 ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged -- not allowed on every host; the budget below covers that.
	$start = time();
	$out   = array();
	foreach ( fstats_jobs() as $key => list( $every, $build ) ) {
		if ( ! $force && time() - fstats_kept_at( $key ) < $every ) {
			$out[ $key ] = 'kept';
			continue;
		}
		// Stay well inside hosts' 60-second limit: what's left waits for the next run.
		if ( time() - $start > 40 ) {
			$out[ $key ] = 'next run';
			continue;
		}
		try {
			$data = $build();
			if ( null !== $data ) {
				update_option( 'fstats_kept_' . $key, array( 't' => time(), 'data' => $data ), false );
			}
			$out[ $key ] = 'ok';
		} catch ( Throwable $e ) {
			error_log( 'Fort Stats refresh, ' . $key . ': ' . $e->getMessage() ); // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
			$out[ $key ] = $e->getMessage();
		}
	}
	delete_transient( 'fstats_refresh_running' );
	return $out;
}

add_action( 'fstats_refresh', 'fstats_refresh' );

add_filter(
	'cron_schedules',
	function ( $schedules ) {
		$schedules['fstats_10min'] = array( 'interval' => 10 * MINUTE_IN_SECONDS, 'display' => __( 'Every 10 minutes', 'fort-stats' ) );
		return $schedules;
	}
);

// The recurring job (set up on activation; put back if it goes missing).
add_action(
	'init',
	function () {
		if ( ! wp_next_scheduled( 'fstats_refresh_tick' ) ) {
			wp_schedule_event( time() + MINUTE_IN_SECONDS, 'fstats_10min', 'fstats_refresh_tick' );
		}
	}
);
add_action( 'fstats_refresh_tick', 'fstats_refresh' );

/** Stops the background job (deactivation). */
function fstats_unschedule() {
	wp_clear_scheduled_hook( 'fstats_refresh_tick' );
	wp_clear_scheduled_hook( 'fstats_refresh' );
}
