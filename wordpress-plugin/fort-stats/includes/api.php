<?php
/**
 * The stats, as PHP functions the theme (and the REST routes) call. FNG numbers everywhere come
 * from the FNG sign-up sheet only, not from backblast counts. Each returns the same array
 * as the matching stats.f3thefort.com /api/* endpoint, or null when there's no data (not
 * configured, Supabase unreachable with no saved copy, or not found).
 *
 * What every page shows (schedule, backblast feed, last week's summary, dashboard, streaks, FNGs)
 * is read from copies the background job keeps fresh (refresh.php): pages never wait on
 * GloomSchedule, Supabase or Google. What's only fetched on request (archive pages and searches,
 * single backblasts, single months) is cached here: an hour, or 15 minutes for backblasts; text
 * searches and archive pages past 20 aren't cached and misses never are. When Supabase can't be
 * reached, the last good copy is served.
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

// ── FNGs come only from the sign-up sheet ─────────────────────────────────────────────────────

/** The sheet's records (kept fresh in the background), or null if it has never been read. */
function fstats_sheet_records() {
	return fstats_kept( 'fng_sheet' );
}

/** array( status, data ) for a background job's stored copy: 200, or 503 before its first fetch. */
function fstats_from_kept( $key ) {
	$data = fstats_kept( $key );
	return null === $data ? array( 503, null ) : array( 200, $data );
}

/** array( 'date|ao' => FNGs ) from the sheet, or null without it. */
function fstats_sheet_by_workout() {
	static $by = false;
	if ( false === $by ) {
		$records = fstats_sheet_records();
		$by      = null === $records ? null : fstats_fng_by_workout( $records );
	}
	return $by;
}

/** FNGs the sheet has for a workout (date, AO): a number, or null (no sheet, or no AO to match). */
function fort_stats_sheet_fngs( $date, $ao ) {
	$by = fstats_sheet_by_workout();
	return null === $by ? null : fstats_fng_for_workout( $by, $date, $ao );
}

/** A backblast item (feed, archive, detail) with its fng_count from the sheet instead of the backblast. */
function fstats_sheet_item( array $item ) {
	$item['fng_count'] = fort_stats_sheet_fngs( $item['date'] ?? '', $item['ao'] ?? '' );
	return $item;
}

// ── Internal: array( status, data ) per endpoint (the REST routes use these) ─────────────────

function fstats_get_core() {
	return fstats_from_kept( 'core' );
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
	return fstats_from_kept( 'streaks' );
}

function fstats_get_backblasts( $days = 7, $limit = 12 ) {
	$days  = fstats_clamp( $days, 7, 1, 31 );
	$limit = fstats_clamp( $limit, 12, 1, 50 );
	$feed  = fstats_kept( 'bb_feed' );
	if ( null === $feed ) {
		return array( 503, null );
	}
	// Cut from the kept 31 days / 50 workouts.
	$today = fstats_region_today();
	$from  = fstats_add_days( $today, -$days );
	$items = array_values( array_filter( $feed['items'], fn( $i ) => $i['date'] >= $from && $i['date'] <= $today ) );
	return array(
		200,
		array(
			'generated_at' => $feed['generated_at'],
			'from'         => $from,
			'to'           => $today,
			'items'        => array_map( 'fstats_sheet_item', array_slice( $items, 0, $limit ) ),
		),
	);
}

/** Last week's totals; its FNG number is the sheet's for those days (null without the sheet). */
function fstats_get_backblast_summary() {
	$res = fstats_from_kept( 'bb_summary' );
	if ( 200 === $res[0] ) {
		$records        = fstats_sheet_records();
		$res[1]['fngs'] = null === $records ? null : fstats_fng_count_between( $records, $res[1]['from'], $res[1]['to'] );
	}
	return $res;
}

/** $args: page, per_page, ao, month, q, type (clamped as the Flask API does). */
function fstats_get_backblast_archive( array $args ) {
	$page     = fstats_clamp( $args['page'] ?? 1, 1, 1, 10000 );
	$per_page = fstats_clamp( $args['per_page'] ?? 24, 24, 1, 60 );
	$ao       = mb_substr( trim( (string) ( $args['ao'] ?? '' ) ), 0, 120 );
	$month    = mb_substr( trim( (string) ( $args['month'] ?? '' ) ), 0, 7 );
	$q        = mb_substr( trim( (string) ( $args['q'] ?? '' ) ), 0, 80 );
	$type     = mb_substr( trim( (string) ( $args['type'] ?? '' ) ), 0, 60 );
	// The page as it first opens comes from the background job.
	if ( 1 === $page && 24 === $per_page && '' === $ao . $month . $q . $type ) {
		$res = fstats_from_kept( 'bb_archive_1' );
		if ( 200 === $res[0] ) {
			$res[1]['items'] = array_map( 'fstats_sheet_item', $res[1]['items'] );
		}
		return $res;
	}
	$build    = fn() => fstats_build( fn( $db ) => fstats_backblast_archive_payload( $db, $page, $per_page, $ao, $month, $q, $type ) );
	$res      = ( '' !== $q || $page > 20 )
		? fstats_cached( 'x', 0, $build, false )
		: fstats_cached( 'bbarchive_' . md5( wp_json_encode( array( $page, $per_page, $ao, $month, $type ) ) ), fstats_ttl( 0.25 ), $build, false );
	if ( 200 === $res[0] ) {
		$res[1]['items'] = array_map( 'fstats_sheet_item', $res[1]['items'] );
	}
	return $res;
}

/** Status 404 for an unknown workout. */
function fstats_get_backblast( $event_id ) {
	$id  = (int) $event_id;
	$res = fstats_cached( 'bb_' . $id, fstats_ttl( 0.25 ), fn() => fstats_build( fn( $db ) => fstats_backblast_detail_payload( $db, $id ) ), false );
	if ( 200 === $res[0] ) {
		$res[1]['item'] = fstats_sheet_item( $res[1]['item'] );
	}
	return $res;
}

function fstats_get_schedule( $days = 7 ) {
	$days  = fstats_clamp( $days, 7, 1, 14 );
	$sched = fstats_kept( 'schedule' );
	if ( null === $sched ) {
		return array( 503, null );
	}
	if ( empty( $sched['configured'] ) ) {
		return array( 200, $sched );
	}
	// Cut from the kept 14 days, starting today (the copy may be from yesterday evening).
	$today = fstats_region_today();
	$list  = array_slice( array_values( array_filter( $sched['days'], fn( $d ) => $d['date'] >= $today ) ), 0, $days );
	$used  = array();
	foreach ( $list as $d ) {
		foreach ( $d['workouts'] as $w ) {
			$used[ $w['ao'] ] = true;
		}
	}
	return array(
		200,
		array(
			'configured'   => true,
			'generated_at' => $sched['generated_at'],
			'from'         => $list ? $list[0]['date'] : $today,
			'to'           => $list ? $list[ count( $list ) - 1 ]['date'] : $today,
			'days'         => $list,
			'aos'          => array_intersect_key( $sched['aos'], $used ),
		),
	);
}

/** The AO map, with each AO's next workout (from the kept schedule) and stats page. */
function fstats_get_map() {
	$map = fstats_kept( 'map' );
	if ( null === $map ) {
		return array( 503, null );
	}
	if ( empty( $map['configured'] ) ) {
		return array( 200, $map );
	}
	$core = fstats_kept( 'core' );
	return array( 200, fstats_map_enrich( $map, fstats_kept( 'schedule' ), $core['ao_data'] ?? null, fstats_region_today() ) );
}

function fstats_get_fng() {
	return fstats_from_kept( 'fng' );
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

function fort_stats_map() {
	return fstats_get_map()[1];
}

function fort_stats_fng() {
	return fstats_get_fng()[1];
}

/** Forgets the on-request cache (Settings → Fort Stats → "Refresh now"); saved copies stay. */
function fstats_flush_cache() {
	global $wpdb;
	$wpdb->query( "DELETE FROM {$wpdb->options} WHERE option_name LIKE '\\_transient\\_fstats\\_%' OR option_name LIKE '\\_transient\\_timeout\\_fstats\\_%'" ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
	wp_cache_flush_group( 'transient' );
}
