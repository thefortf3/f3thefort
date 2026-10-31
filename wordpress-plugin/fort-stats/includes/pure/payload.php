<?php
/**
 * The stats site's JSON payloads. A faithful port of the stats repo's web/payload.py: the same
 * keys, order, numbers and text for the same data, so the WordPress pages and the theme see
 * exactly what stats.f3thefort.com's /api/* gives. Pure: the data comes in through FStats_Source /
 * FStats_Schedule and FNG records; "now" and "today" can be passed in.
 *
 * Dates: core, streaks and FNG use the server's date in UTC (Python's date.today() in the
 * stats container); backblasts and the schedule use the region's (America/New_York).
 *
 * @package FortStats
 */

defined( 'ABSPATH' ) || exit;

const FSTATS_BLUE = '#4f8ef7';

const FSTATS_STREAK_META = array(
	array( 'id' => 'weekly_posts', 'label' => 'Weekly Posts', 'unit' => 'wks', 'desc' => 'Consecutive weeks posting' ),
	array( 'id' => 'monthly_posts', 'label' => 'Monthly Posts', 'unit' => 'mo', 'desc' => 'Consecutive months posting' ),
	array( 'id' => 'q_streak', 'label' => 'Q Streak', 'unit' => 'wks', 'desc' => 'Consecutive weeks leading a workout' ),
	array( 'id' => 'double_down', 'label' => 'Double Down', 'unit' => 'wks', 'desc' => 'Consecutive weeks posting 2+ times' ),
	array( 'id' => 'ao_loyalty', 'label' => 'AO Loyalty', 'unit' => 'wks', 'desc' => 'Consecutive weeks at home AO' ),
);
const FSTATS_DOW_NAMES = array( 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday' );

// ── Python-compatible helpers ─────────────────────────────────────────────────

/** Python's str.strip(): Unicode whitespace on both ends. */
function fstats_py_strip( $s ) {
	return preg_replace( '/(*UCP)^\s+|\s+$/u', '', (string) $s );
}

/** Python's datetime.now().isoformat(timespec="seconds") in UTC (the stats container's clock). */
function fstats_now_iso() {
	return gmdate( 'Y-m-d\TH:i:s' );
}

function fstats_utc_today() {
	return gmdate( 'Y-m-d' );
}

/** Today in the region (America/New_York): the backblast feed and schedule roll over at midnight there. */
function fstats_region_today() {
	return ( new DateTimeImmutable( 'now', new DateTimeZone( 'America/New_York' ) ) )->format( 'Y-m-d' );
}

/** $date (Y-m-d) plus $days days. */
function fstats_add_days( $date, $days ) {
	return gmdate( 'Y-m-d', strtotime( $date . ' 00:00:00 UTC' ) + (int) $days * 86400 );
}

/** A float as Python prints it (repr): shortest round-trip form, always with a decimal point. */
function fstats_py_float( $f ) {
	return json_encode( (float) $f, JSON_PRESERVE_ZERO_FRACTION ); // phpcs:ignore WordPress.WP.AlternativeFunctions.json_encode_json_encode -- shortest form: "6.8", "0.0".
}

// ── Date windows ──────────────────────────────────────────────────────────────

function fstats_windows( $today ) {
	return array(
		'ytd'    => substr( $today, 0, 4 ) . '-01-01',
		'last90' => fstats_add_days( $today, -90 ),
		'last30' => fstats_add_days( $today, -30 ),
		'year'   => fstats_add_days( $today, -365 ),
	);
}

/** 'YYYY-MM' → array( first day, last day ). */
function fstats_month_bounds( $key ) {
	list( $y, $m ) = array_map( 'intval', explode( '-', $key ) );
	return array( sprintf( '%04d-%02d-01', $y, $m ), sprintf( '%04d-%02d-%02d', $y, $m, fstats_days_in_month( $y, $m ) ) );
}

function fstats_days_in_month( $y, $m ) {
	return (int) gmdate( 't', gmmktime( 0, 0, 0, $m, 1, $y ) );
}

// ── Streaks ───────────────────────────────────────────────────────────────────

function fstats_week_to_int( $w ) {
	return preg_match( '/(\d{4})-W(\d{2})/', (string) $w, $m ) ? (int) $m[1] * 100 + (int) $m[2] : 0;
}

function fstats_weeks_consecutive( $a, $b ) {
	$ay = intdiv( $a, 100 );
	$aw = $a % 100;
	$by = intdiv( $b, 100 );
	$bw = $b % 100;
	if ( $ay === $by ) {
		return 1 === $bw - $aw;
	}
	if ( 1 === $by - $ay ) {
		return $aw >= 51 && $bw <= 1;
	}
	return false;
}

function fstats_month_to_int( $s ) {
	list( $y, $m ) = explode( '-', $s );
	return (int) $y * 100 + (int) $m;
}

function fstats_months_consecutive( $a, $b ) {
	$ay = intdiv( $a, 100 );
	$am = $a % 100;
	$by = intdiv( $b, 100 );
	$bm = $b % 100;
	if ( $ay === $by ) {
		return 1 === $bm - $am;
	}
	return 1 === $by - $ay && 12 === $am && 1 === $bm;
}

/** array( current streak, longest streak ) of a set of period numbers. */
function fstats_streak( array $periods, $current_period, callable $is_consec, $grace ) {
	if ( ! $periods ) {
		return array( 0, 0 );
	}
	$ints = array_values( array_unique( $periods ) );
	sort( $ints );
	$max_s = 1;
	$cur   = 1;
	for ( $i = 1, $n = count( $ints ); $i < $n; $i++ ) {
		if ( $is_consec( $ints[ $i - 1 ], $ints[ $i ] ) ) {
			++$cur;
			$max_s = max( $max_s, $cur );
		} else {
			$cur = 1;
		}
	}
	if ( $current_period - $ints[ count( $ints ) - 1 ] > $grace ) {
		return array( 0, $max_s );
	}
	$current_s = 1;
	for ( $i = count( $ints ) - 2; $i >= 0; $i-- ) {
		if ( $is_consec( $ints[ $i ], $ints[ $i + 1 ] ) ) {
			++$current_s;
		} else {
			break;
		}
	}
	return array( $current_s, $max_s );
}

/** array( user_id => periods ) → rows (user_id, current_streak, max_streak), longest current first. */
function fstats_compute_streaks( array $activity, $today, $period = 'week' ) {
	if ( 'week' === $period ) {
		$to_int    = 'fstats_week_to_int';
		$is_consec = 'fstats_weeks_consecutive';
		$grace     = 2;
		$current   = fstats_week_to_int( gmdate( 'o-\WW', strtotime( $today . ' 00:00:00 UTC' ) ) );
	} else {
		$to_int    = 'fstats_month_to_int';
		$is_consec = 'fstats_months_consecutive';
		$grace     = 1;
		$current   = (int) substr( $today, 0, 4 ) * 100 + (int) substr( $today, 5, 2 );
	}
	$out = array();
	foreach ( $activity as $uid => $periods ) {
		list( $cur_s, $max_s ) = fstats_streak( array_map( $to_int, (array) $periods ), $current, $is_consec, $grace );
		$out[] = array( 'user_id' => $uid, 'current_streak' => $cur_s, 'max_streak' => $max_s );
	}
	usort( $out, fn( $a, $b ) => $b['current_streak'] <=> $a['current_streak'] ?: $b['max_streak'] <=> $a['max_streak'] );
	return $out;
}

// ── AO sparkline (inline SVG, monthly bars) ──────────────────────────────────

function fstats_sparkline_svg( array $values, $width = 80, $height = 24 ) {
	if ( ! $values ) {
		return '<svg width="' . $width . '" height="' . $height . '"></svg>';
	}
	$mx   = max( $values ) ?: 1;
	$n    = count( $values );
	$gap  = 1;
	$bw   = max( 1, ( $width - $gap * ( $n - 1 ) ) / $n );
	$bars = '';
	foreach ( array_values( $values ) as $i => $v ) {
		$bh    = max( 1, (int) round( $v / $mx * $height, 0, PHP_ROUND_HALF_EVEN ) ); // Python's round() rounds halves to even.
		$x     = round( $i * ( $bw + $gap ), 1, PHP_ROUND_HALF_EVEN );
		$bars .= '<rect x="' . fstats_py_float( $x ) . '" y="' . ( $height - $bh ) . '" width="' . sprintf( '%.1f', $bw ) . '" height="' . $bh . '" rx="1" fill="' . FSTATS_BLUE . '" opacity="0.8"/>';
	}
	return '<svg xmlns="http://www.w3.org/2000/svg" width="' . $width . '" height="' . $height . '" style="display:block">' . $bars . '</svg>';
}

// ── The dashboard ─────────────────────────────────────────────────────────────

function fstats_core_payload( FStats_Source $db, $today = null, $now = null ) {
	$today = $today ?: fstats_utc_today();
	$w     = fstats_windows( $today );
	$n     = 800;

	$leaderboards = array(
		'all_time' => $db->attendance_leaderboard( null, null, $n ),
		'ytd'      => $db->attendance_leaderboard( $w['ytd'], null, $n ),
		'last90'   => $db->attendance_leaderboard( $w['last90'], null, $n ),
		'last30'   => $db->attendance_leaderboard( $w['last30'], null, $n ),
	);

	$pax_stats   = $db->all_pax_stats();
	$pax_top_aos = $db->pax_top_aos( 5 );

	$weekly_streaks = fstats_compute_streaks( $db->pax_weekly_activity(), $today, 'week' );
	$smap           = array();
	foreach ( $weekly_streaks as $s ) {
		$smap[ $s['user_id'] ] = $s;
	}
	foreach ( $pax_stats as &$p ) {
		$s                   = $smap[ $p['user_id'] ] ?? array();
		$p['current_streak'] = $s['current_streak'] ?? 0;
		$p['max_streak']     = $s['max_streak'] ?? 0;
	}
	unset( $p );

	$ao_windows = array(
		'all_time' => $db->ao_breakdown(),
		'ytd'      => $db->ao_breakdown( $w['ytd'] ),
		'last90'   => $db->ao_breakdown( $w['last90'] ),
		'last30'   => $db->ao_breakdown( $w['last30'] ),
	);
	$ao_top     = array(
		'all_time' => $db->ao_top_attendees( 15 ),
		'ytd'      => $db->ao_top_attendees( 15, $w['ytd'] ),
		'last90'   => $db->ao_top_attendees( 15, $w['last90'] ),
		'last30'   => $db->ao_top_attendees( 15, $w['last30'] ),
	);
	$ao_monthly = $db->ao_monthly_trend( $w['year'] );
	$ao_no_q    = $db->ao_most_posts_no_q( $w['ytd'] );

	$monthly_trend = $db->monthly_trend( $w['year'] );
	$weekly_trend  = $db->weekly_posts( $w['year'] );

	$region_name      = $db->region_name();
	$sync             = $db->sync_status();
	$available_months = $db->available_months( 24 );

	// AO sparklines: the last 12 months of PAX posts per AO.
	$by_ao  = array();
	$months = array();
	foreach ( $ao_monthly as $r ) {
		$by_ao[ $r['ao_id'] ][ $r['month'] ] = $r['pax_posts'];
		$months[ $r['month'] ]               = true;
	}
	$months = array_keys( $months );
	sort( $months, SORT_STRING );
	$months12   = array_slice( $months, -12 );
	$sparklines = array();
	foreach ( $ao_windows['all_time'] as $ao ) {
		$sparklines[ $ao['ao_id'] ] = fstats_sparkline_svg( array_map( fn( $m ) => $by_ao[ $ao['ao_id'] ][ $m ] ?? 0, $months12 ) );
	}

	$synced_at = ( $sync['last_daily_sync']['value'] ?? '' ) ?: ( ( $sync['last_full_sync']['value'] ?? '' ) ?: '' );

	$streak_types = FSTATS_STREAK_META;
	for ( $d = 0; $d < 7; $d++ ) {
		$streak_types[] = array(
			'id'    => 'dow_' . $d,
			'label' => FSTATS_DOW_NAMES[ $d ] . ' Streak',
			'unit'  => 'wks',
			'desc'  => 'Consecutive weeks posting on ' . FSTATS_DOW_NAMES[ $d ],
		);
	}

	return array(
		'region_name'      => $region_name,
		'synced_at'        => $synced_at,
		'generated_at'     => $now ?: fstats_now_iso(),
		'today'            => $today,
		'available_months' => $available_months,
		'streak_types'     => $streak_types,
		'leaderboards'     => $leaderboards,
		'pax_stats'        => $pax_stats,
		'pax_top_aos'      => $pax_top_aos,
		'weekly_streaks'   => $weekly_streaks,
		'ao_data'          => $ao_windows,
		'ao_top_attendees' => $ao_top,
		'ao_monthly_trend' => $ao_monthly,
		'ao_no_q'          => $ao_no_q,
		'ao_sparklines'    => $sparklines,
		'monthly_trend'    => $monthly_trend,
		'weekly_trend'     => $weekly_trend,
	);
}

/** Leaderboard and AO breakdown for one 'YYYY-MM'. Null for a malformed month (the API answers 400). */
function fstats_month_payload( FStats_Source $db, $key ) {
	// Python's calendar.monthrange also refuses month 00 or 13+ (→ 400).
	if ( ! preg_match( '/^\d{4}-\d{2}$/', (string) $key ) || (int) substr( $key, 5, 2 ) < 1 || (int) substr( $key, 5, 2 ) > 12 ) {
		return null;
	}
	list( $start, $end ) = fstats_month_bounds( $key );
	return array(
		'leaderboard' => $db->attendance_leaderboard( $start, $end, 800 ),
		'aos'         => $db->ao_breakdown( $start, $end ),
	);
}

function fstats_streaks_payload( FStats_Source $db, $today = null ) {
	$today   = $today ?: fstats_utc_today();
	$streaks = array(
		'weekly_posts'  => fstats_compute_streaks( $db->pax_weekly_activity(), $today, 'week' ),
		'monthly_posts' => fstats_compute_streaks( $db->pax_monthly_activity(), $today, 'month' ),
		'q_streak'      => fstats_compute_streaks( $db->pax_q_weekly_activity(), $today, 'week' ),
		'double_down'   => fstats_compute_streaks( $db->pax_double_weekly_activity(), $today, 'week' ),
		'ao_loyalty'    => fstats_compute_streaks( $db->pax_home_ao_weekly_activity(), $today, 'week' ),
	);
	for ( $d = 0; $d < 7; $d++ ) {
		$streaks[ 'dow_' . $d ] = fstats_compute_streaks( $db->pax_dow_weekly_activity( $d ), $today, 'week' );
	}
	return array( 'streaks' => $streaks );
}

// ── FNGs (from the sign-up sheet) ─────────────────────────────────────────────

/** array( value => count ) in first-seen order → [ [value, count] ], most first (ties keep their order). */
function fstats_most_common( array $counts, $n = null ) {
	$pairs = array();
	foreach ( $counts as $k => $c ) {
		$pairs[] = array( (string) $k, $c );
	}
	usort( $pairs, fn( $a, $b ) => $b[1] <=> $a[1] );
	return null === $n ? $pairs : array_slice( $pairs, 0, $n );
}

/** FNG totals, windows, top EHers, by AO and month, and the latest 20. */
function fstats_fng_payload( array $records, $today = null ) {
	if ( ! $records ) {
		return array( 'total' => 0 );
	}
	$today     = $today ?: fstats_utc_today();
	$ytd_start = substr( $today, 0, 4 ) . '-01-01';
	$ago90     = fstats_add_days( $today, -90 );
	$ago30     = fstats_add_days( $today, -30 );
	$ytd       = array_values( array_filter( $records, fn( $r ) => $r['date'] >= $ytd_start ) );

	$counts = function ( array $rows, $key ) {
		$c = array();
		foreach ( $rows as $r ) {
			$v = fstats_py_strip( (string) $r[ $key ] );
			if ( '' !== $v ) {
				$c[ $v ] = ( $c[ $v ] ?? 0 ) + 1;
			}
		}
		return $c;
	};
	$months = array();
	foreach ( $records as $r ) {
		$m            = substr( $r['date'], 0, 7 );
		$months[ $m ] = ( $months[ $m ] ?? 0 ) + 1;
	}
	ksort( $months, SORT_STRING );
	$names  = fn( $pairs ) => array_map( fn( $p ) => array( 'name' => $p[0], 'count' => $p[1] ), $pairs );
	$aos    = fn( $pairs ) => array_map( fn( $p ) => array( 'ao' => $p[0], 'count' => $p[1] ), $pairs );
	$recent = $records;
	// Newest first; equal dates keep their original order, as with Python's sorted( …, reverse=True ).
	usort( $recent, fn( $a, $b ) => strcmp( $b['date'], $a['date'] ) );

	return array(
		'total'         => count( $records ),
		'ytd'           => count( $ytd ),
		'last90'        => count( array_filter( $records, fn( $r ) => $r['date'] >= $ago90 ) ),
		'last30'        => count( array_filter( $records, fn( $r ) => $r['date'] >= $ago30 ) ),
		'top_ehers'     => $names( fstats_most_common( $counts( $records, 'eh' ), 25 ) ),
		'top_ehers_ytd' => $names( fstats_most_common( $counts( $ytd, 'eh' ), 25 ) ),
		'by_ao'         => $aos( fstats_most_common( $counts( $records, 'ao' ) ) ),
		'by_ao_ytd'     => $aos( fstats_most_common( $counts( $ytd, 'ao' ) ) ),
		'monthly'       => array_map( fn( $m, $c ) => array( 'month' => (string) $m, 'count' => $c ), array_keys( $months ), $months ),
		'recent'        => array_map(
			fn( $r ) => array( 'date' => $r['date'], 'f3_name' => $r['f3_name'], 'eh' => $r['eh'], 'ao' => $r['ao'] ),
			array_slice( $recent, 0, 20 )
		),
	);
}

// ── Backblasts (for the theme) ────────────────────────────────────────────────

/** The lines Slackblast puts at the top of every backblast; the write-up starts after them. */
const FSTATS_BB_HEADER = '/(*UCP)^\s*(backblast!|date:|ao:|q:|co-?qs?:|pax:|fngs?:|count:|total:)/iu';

/** array( body, excerpt ): the backblast without its header lines, and its first ~220 characters on one line, cut on a word. */
function fstats_backblast_body( $text ) {
	if ( null === $text || '' === $text ) {
		return array( '', '' );
	}
	$lines = explode( "\n", str_replace( "\r\n", "\n", (string) $text ) );
	$i     = 0;
	$n     = count( $lines );
	while ( $i < $n && ( '' === fstats_py_strip( $lines[ $i ] ) || preg_match( FSTATS_BB_HEADER, $lines[ $i ] ) ) ) {
		++$i;
	}
	$body = fstats_py_strip( implode( "\n", array_slice( $lines, $i ) ) );
	$flat = fstats_py_strip( preg_replace( '/(*UCP)\s+/u', ' ', $body ) );
	if ( mb_strlen( $flat ) > 220 ) {
		$cut  = mb_substr( $flat, 0, 220 );
		$sp   = mb_strrpos( $cut, ' ' );
		$flat = false !== $sp ? rtrim( mb_substr( $cut, 0, $sp ), ',.;:-' ) . '…' : $cut . '…';
	}
	return array( $body, $flat );
}

/** '05:30:00' / '5:30' / '0530' → '0530'; anything else unchanged. */
function fstats_hhmm( $t ) {
	if ( null === $t || '' === $t || false === $t ) {
		return '';
	}
	$s = fstats_py_strip( (string) $t );
	return preg_match( '/^(\d{1,2}):?(\d{2})(?::\d{2})?$/', $s, $m ) ? sprintf( '%02d', (int) $m[1] ) . $m[2] : $s;
}

/** A title, trimmed, or null when empty (as Python's `(x or "").strip() or None`). */
function fstats_title( $t ) {
	$t = fstats_py_strip( (string) ( $t ?? '' ) );
	return '' === $t ? null : $t;
}

function fstats_truthy_list( $list ) {
	return array_values( array_filter( (array) ( $list ?? array() ), fn( $x ) => null !== $x && '' !== $x && false !== $x ) );
}

/** Recent posted workouts, newest first. */
function fstats_backblasts_payload( FStats_Source $db, $days = 7, $limit = 12, $today = null, $now = null ) {
	$today = $today ?: fstats_region_today();
	$start = fstats_add_days( $today, -$days );
	$items = array();
	foreach ( $db->recent_workouts( $start, $today, $limit ) as $r ) {
		$items[] = array(
			'event_id'  => $r['event_instance_id'],
			'date'      => (string) $r['start_date'],
			'ao'        => $r['ao_name'],
			'location'  => $r['location_name'],
			'pax_count' => (int) ( $r['pax_count'] ?: 0 ),
			'fng_count' => (int) ( $r['fng_count'] ?: 0 ),
			'qs'        => fstats_truthy_list( $r['qs'] ),
			'title'     => fstats_title( $r['title'] ?? null ),
			'excerpt'   => fstats_backblast_body( $r['backblast'] ?? null )[1],
		);
	}
	return array( 'generated_at' => $now ?: fstats_now_iso(), 'from' => $start, 'to' => $today, 'items' => $items );
}

/** The last 7 days ending yesterday: totals, an 8-week PAX-post trend and the top AOs. */
function fstats_backblast_summary_payload( FStats_Source $db, $today = null, $now = null ) {
	$today       = $today ?: fstats_region_today();
	$end         = fstats_add_days( $today, -1 );
	$start       = fstats_add_days( $end, -6 );
	$trend_start = fstats_add_days( $end, -56 );

	$s    = $db->summary( $start, $end );
	$fngs = 0;
	foreach ( $db->recent_workouts( $start, $end, 1000 ) as $r ) {
		$fngs += (int) ( $r['fng_count'] ?: 0 );
	}
	$weeks = array_slice( $db->weekly_posts( $trend_start, $end ), -8 );
	$aos   = array_slice( $db->ao_breakdown( $start, $end ), 0, 3 );
	return array(
		'from'         => $start,
		'to'           => $end,
		'workouts'     => (int) $s['workouts'],
		'pax_posts'    => (int) $s['pax_posts'],
		'unique_pax'   => (int) $s['unique_pax'],
		'fngs'         => $fngs,
		'weekly_trend' => array_map( fn( $w ) => array( 'week' => $w['week'], 'posts' => (int) $w['pax_posts'] ), $weeks ),
		'top_aos'      => array_map( fn( $a ) => array( 'ao' => $a['ao_name'], 'posts' => (int) $a['pax_posts'] ), $aos ),
		'generated_at' => $now ?: fstats_now_iso(),
	);
}

/**
 * Scheduled workouts from today through $days days out, with their Qs (GloomSchedule). Workouts
 * with no Q and AOs past their shutdown date are left out. configured=false when there's no
 * GloomSchedule ($gs null).
 */
function fstats_schedule_payload( ?FStats_Schedule $gs, $days = 7, $today = null, $now = null ) {
	$today = $today ?: fstats_region_today();
	if ( ! $gs ) {
		return array( 'configured' => false, 'from' => $today, 'to' => $today, 'days' => array() );
	}
	$aos = array();
	foreach ( $gs->get_ao_details( false )['aos'] ?? array() as $a ) {
		$aos[ fstats_py_strip( (string) ( $a['name'] ?? '' ) ) ] = $a;
	}
	$used     = array();
	$out_days = array();
	for ( $n = 0; $n < $days; $n++ ) {
		$d        = fstats_add_days( $today, $n );
		$workouts = array();
		foreach ( $gs->get_scheduled_qs( $d )['scheduled_events'] ?? array() as $ev ) {
			$name = fstats_py_strip( (string) ( $ev['ao_name'] ?? '' ) );
			$qs   = array_values( array_filter( array_map( fn( $q ) => $q['f3_name'] ?? null, (array) ( $ev['qs'] ?? array() ) ) ) );
			if ( '' === $name || ! $qs ) {
				continue;
			}
			$shutdown = $aos[ $name ]['shutdown_date'] ?? null;
			if ( $shutdown && substr( $shutdown, 0, 10 ) <= $d ) {
				continue;
			}
			$used[ $name ] = true;
			$type          = (string) ( $ev['event_type'] ?? '' );
			$workouts[]    = array(
				'ao'         => $name,
				'start_time' => fstats_hhmm( $ev['start_time'] ?? null ),
				'event_type' => $type,
				'is_workout' => '1stF Workout' === $type,
				'qs'         => $qs,
			);
		}
		usort( $workouts, fn( $a, $b ) => strcmp( '' !== $a['start_time'] ? $a['start_time'] : '9999', '' !== $b['start_time'] ? $b['start_time'] : '9999' ) ?: strcmp( $a['ao'], $b['ao'] ) );
		$out_days[] = array( 'date' => $d, 'workouts' => $workouts );
	}
	$names = array_map( 'strval', array_keys( $used ) );
	sort( $names, SORT_STRING );
	$site = array();
	foreach ( $names as $name ) {
		$site[ $name ] = array( 'site_qs' => array_values( array_filter( array_map( fn( $q ) => $q['f3_name'] ?? null, (array) ( $aos[ $name ]['site_qs'] ?? array() ) ) ) ) );
	}
	return array(
		'configured'   => true,
		'generated_at' => $now ?: fstats_now_iso(),
		'from'         => $today,
		'to'           => fstats_add_days( $today, $days - 1 ),
		'days'         => $out_days,
		'aos'          => $site,
	);
}

/** A backblast row → an archive item. */
function fstats_bb_item( array $r ) {
	return array(
		'event_id'   => $r['event_instance_id'],
		'date'       => (string) $r['start_date'],
		'start_time' => fstats_hhmm( $r['start_time'] ?? null ) ?: null,
		'ao'         => $r['ao_name'],
		'location'   => $r['location_name'] ?? null,
		'pax_count'  => (int) ( ( $r['pax_count'] ?? 0 ) ?: 0 ),
		'fng_count'  => (int) ( ( $r['fng_count'] ?? 0 ) ?: 0 ),
		'qs'         => fstats_truthy_list( $r['qs'] ?? array() ),
		'title'      => fstats_title( $r['title'] ?? null ),
		'excerpt'    => fstats_backblast_body( $r['backblast'] ?? null )[1],
		'types'      => fstats_truthy_list( $r['workout_types'] ?? array() ),
	);
}

/** A page of backblasts (newest first) with the filter choices. */
function fstats_backblast_archive_payload( FStats_Source $db, $page = 1, $per_page = 24, $ao = '', $month = '', $q = '', $workout_type = '', $now = null ) {
	$month = preg_match( '/^\d{4}-\d{2}$/D', (string) $month ) ? $month : '';
	$res   = $db->search_backblasts( '' !== $ao ? $ao : null, '' !== $month ? $month : null, '' !== $q ? $q : null, '' !== $workout_type ? $workout_type : null, $per_page, ( $page - 1 ) * $per_page );
	return array(
		'generated_at' => $now ?: fstats_now_iso(),
		'page'         => $page,
		'per_page'     => $per_page,
		'total'        => $res['total'],
		'pages'        => max( 1, intdiv( $res['total'] + $per_page - 1, $per_page ) ),
		'filters'      => array( 'ao' => $ao, 'month' => $month, 'q' => $q, 'type' => $workout_type ),
		'choices'      => $db->backblast_filters(),
		'items'        => array_map( 'fstats_bb_item', $res['rows'] ),
	);
}

/** One backblast with its full write-up and who posted, or null. */
function fstats_backblast_detail_payload( FStats_Source $db, $event_id, $now = null ) {
	$r = $db->backblast( (int) $event_id );
	if ( ! $r ) {
		return null;
	}
	$item                     = fstats_bb_item( $r );
	list( $body )             = fstats_backblast_body( $r['backblast'] ?? null );
	$paras                    = array_values( array_filter( array_map( 'fstats_py_strip', preg_split( '/(*UCP)\n\s*\n/u', $body ) ), fn( $p ) => '' !== $p ) );
	$item['body']             = $body;
	$item['paragraphs']       = $paras;
	$item['coqs']             = $r['coqs'] ?? array();
	$item['pax']              = $r['pax'] ?? array();
	return array( 'generated_at' => $now ?: fstats_now_iso(), 'item' => $item );
}
