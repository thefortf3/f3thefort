<?php
/**
 * The stats, as PHP functions the theme (and the REST routes) call. Each returns the same array
 * as the matching stats.f3thefort.com /api/* endpoint, or null when there's no data (not
 * configured, Supabase unreachable with no saved copy, or not found).
 *
 * Caching, as the Flask app's: the data changes once a day, so results are kept (transients) for
 * an hour; the backblast feed, archive and schedule for less. Text searches and archive pages past
 * 20 aren't cached (so arbitrary queries can't fill the cache) and misses never are. When Supabase
 * can't be reached, the last good copy is served.
 *
 * @package FortStats
 */

defined( 'ABSPATH' ) || exit;

/**
 * Builds (or reuses) one cached result. Returns array( status, data ): 200 with the payload,
 * 404 when $build returned null, 503 when the data couldn't be fetched and there's no saved copy.
 *
 * @param string   $key       Cache key (short, safe).
 * @param int      $ttl       Seconds to keep it; 0 = don't cache.
 * @param callable $build     Returns the payload or null; may throw FStats_Unavailable.
 * @param bool     $keep_last Keep a copy to serve when Supabase is down.
 */
function fstats_cached( $key, $ttl, callable $build, $keep_last = true ) {
	$tkey = 'fstats_' . $key;
	if ( $ttl > 0 ) {
		$hit = get_transient( $tkey );
		if ( false !== $hit ) {
			return array( 200, $hit );
		}
		// Someone else is already rebuilding this: serve the saved copy meanwhile.
		if ( $keep_last && get_transient( $tkey . '_lock' ) ) {
			$last = get_option( 'fstats_last_' . $key );
			if ( false !== $last ) {
				return array( 200, $last );
			}
		}
		set_transient( $tkey . '_lock', 1, 60 );
	}
	try {
		$data = $build();
	} catch ( FStats_Unavailable $e ) {
		delete_transient( $tkey . '_lock' );
		error_log( 'Fort Stats: ' . $e->getMessage() ); // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		$last = $keep_last ? get_option( 'fstats_last_' . $key ) : false;
		return false !== $last ? array( 200, $last ) : array( 503, null );
	}
	delete_transient( $tkey . '_lock' );
	if ( null === $data ) {
		return array( 404, null );
	}
	if ( $ttl > 0 ) {
		set_transient( $tkey, $data, $ttl );
	}
	if ( $keep_last ) {
		update_option( 'fstats_last_' . $key, $data, false );
	}
	return array( 200, $data );
}

/** Seconds to keep results: FORT_STATS_CACHE_TTL in wp-config.php (default an hour). */
function fstats_ttl( $fraction = 1 ) {
	$base = defined( 'FORT_STATS_CACHE_TTL' ) ? (int) FORT_STATS_CACHE_TTL : HOUR_IN_SECONDS;
	return max( 0, (int) round( $base * $fraction ) );
}

function fstats_clamp( $v, $default, $lo, $hi ) {
	return is_numeric( $v ) ? max( $lo, min( $hi, (int) $v ) ) : $default;
}

// ── Internal: array( status, data ) per endpoint (the REST routes use these) ─────────────────

function fstats_get_core() {
	return fstats_cached( 'core', fstats_ttl(), fn() => fstats_build( fn( $db ) => fstats_core_payload( $db ) ) );
}

/** Status 400 for a malformed month. */
function fstats_get_month( $key ) {
	$key = (string) $key;
	if ( null === fstats_month_payload( new FStats_Rest_Source(), $key ) ) {
		return array( 400, null );
	}
	return fstats_cached( 'month_' . $key, fstats_ttl(), fn() => fstats_build( fn( $db ) => fstats_month_payload( $db, $key ) ) );
}

function fstats_get_streaks() {
	return fstats_cached( 'streaks', fstats_ttl(), fn() => fstats_build( fn( $db ) => fstats_streaks_payload( $db ) ) );
}

function fstats_get_backblasts( $days = 7, $limit = 12 ) {
	$days  = fstats_clamp( $days, 7, 1, 31 );
	$limit = fstats_clamp( $limit, 12, 1, 50 );
	return fstats_cached( "bb_{$days}_{$limit}", fstats_ttl( 0.25 ), fn() => fstats_build( fn( $db ) => fstats_backblasts_payload( $db, $days, $limit ) ) );
}

function fstats_get_backblast_summary() {
	return fstats_cached( 'bb_summary', fstats_ttl( 0.25 ), fn() => fstats_build( fn( $db ) => fstats_backblast_summary_payload( $db ) ) );
}

/** $args: page, per_page, ao, month, q, type (clamped as the Flask API does). */
function fstats_get_backblast_archive( array $args ) {
	$page     = fstats_clamp( $args['page'] ?? 1, 1, 1, 10000 );
	$per_page = fstats_clamp( $args['per_page'] ?? 24, 24, 1, 60 );
	$ao       = mb_substr( trim( (string) ( $args['ao'] ?? '' ) ), 0, 120 );
	$month    = mb_substr( trim( (string) ( $args['month'] ?? '' ) ), 0, 7 );
	$q        = mb_substr( trim( (string) ( $args['q'] ?? '' ) ), 0, 80 );
	$type     = mb_substr( trim( (string) ( $args['type'] ?? '' ) ), 0, 60 );
	$build    = fn() => fstats_build( fn( $db ) => fstats_backblast_archive_payload( $db, $page, $per_page, $ao, $month, $q, $type ) );
	if ( '' !== $q || $page > 20 ) {
		return fstats_cached( 'x', 0, $build, false );
	}
	return fstats_cached( 'bbarchive_' . md5( wp_json_encode( array( $page, $per_page, $ao, $month, $type ) ) ), fstats_ttl( 0.25 ), $build, false );
}

/** Status 404 for an unknown workout. */
function fstats_get_backblast( $event_id ) {
	$id = (int) $event_id;
	return fstats_cached( 'bb_' . $id, fstats_ttl( 0.25 ), fn() => fstats_build( fn( $db ) => fstats_backblast_detail_payload( $db, $id ) ), false );
}

function fstats_get_schedule( $days = 7 ) {
	$days = fstats_clamp( $days, 7, 1, 14 );
	return fstats_cached(
		'schedule_' . $days,
		min( fstats_ttl(), 600 ), // The Q schedule changes during the day (people sign up).
		fn() => fstats_schedule_payload( FStats_GloomSchedule::from_config(), $days )
	);
}

function fstats_get_fng() {
	return fstats_cached( 'fng', fstats_ttl(), fn() => fstats_fng_payload( fstats_fng_records() ) );
}

function fstats_get_fng_challenge() {
	$start = fstats_setting( 'fng_start' ) ?: '2026-09-01';
	$end   = fstats_setting( 'fng_end' ) ?: '2026-09-30';
	return fstats_cached(
		'fng_challenge_' . md5( $start . $end ),
		fstats_ttl(),
		function () use ( $start, $end ) {
			$records = fstats_fng_records();
			return fstats_build( fn( $db ) => fstats_fng_challenge_payload( $db, $records, $start, $end ) );
		}
	);
}

// ── Public: the payload, or null ──────────────────────────────────────────────────────────────

function fort_stats_core() {
	return fstats_get_core()[1];
}

function fort_stats_month( $key ) {
	return fstats_get_month( $key )[1];
}

function fort_stats_streaks() {
	return fstats_get_streaks()[1];
}

function fort_stats_backblasts( $days = 7, $limit = 12 ) {
	return fstats_get_backblasts( $days, $limit )[1];
}

function fort_stats_backblast_summary() {
	return fstats_get_backblast_summary()[1];
}

function fort_stats_backblast_archive( array $args ) {
	return fstats_get_backblast_archive( $args )[1];
}

function fort_stats_backblast( $event_id ) {
	return fstats_get_backblast( $event_id )[1];
}

function fort_stats_schedule( $days = 7 ) {
	return fstats_get_schedule( $days )[1];
}

function fort_stats_fng() {
	return fstats_get_fng()[1];
}

function fort_stats_fng_challenge() {
	return fstats_get_fng_challenge()[1];
}

/** Forgets every cached result (Settings → Fort Stats → "Refresh now"); saved copies stay. */
function fstats_flush_cache() {
	global $wpdb;
	$wpdb->query( "DELETE FROM {$wpdb->options} WHERE option_name LIKE '\\_transient\\_fstats\\_%' OR option_name LIKE '\\_transient\\_timeout\\_fstats\\_%'" ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
	wp_cache_flush_group( 'transient' );
}
