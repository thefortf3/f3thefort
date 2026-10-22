<?php
/**
 * Shaping the stats payloads for the stats pages (the theme renders them): leaderboard sorting,
 * ranks and search, home AOs, one PAX's and one AO's details, streak lists, month series and
 * milestones. Pure functions of the payload arrays (payload.php).
 *
 * @package FortStats
 */

defined( 'ABSPATH' ) || exit;

/** The leaderboard windows, in display order. */
const FSTATS_RANGES = array(
	'ytd'      => 'YTD',
	'last90'   => '90 days',
	'last30'   => '30 days',
	'all_time' => 'All-time',
);

/** Post counts worth a badge. */
const FSTATS_MILESTONES = array( 25, 50, 100, 150, 200, 250, 300, 400, 500, 750, 1000 );

/** array( user_id => home AO name ): each PAX's most-posted AO (pax_top_aos rank 1). */
function fstats_home_aos( array $pax_top_aos ) {
	$out = array();
	foreach ( $pax_top_aos as $r ) {
		if ( ! isset( $out[ $r['user_id'] ] ) ) {
			$out[ $r['user_id'] ] = $r['ao_name'];
		}
	}
	return $out;
}

/** array( user_id => name ) from pax_stats. */
function fstats_names( array $pax_stats ) {
	$out = array();
	foreach ( $pax_stats as $p ) {
		$out[ $p['user_id'] ] = $p['f3_name'];
	}
	return $out;
}

/**
 * Leaderboard rows sorted by posts (as given) or Qs (then posts), each with its 'rank' (1 = top)
 * and 'q_pct' (share of posts as Q, rounded; null without posts).
 */
function fstats_rank_rows( array $rows, $sort = 'posts' ) {
	if ( 'qs' === $sort ) {
		usort( $rows, fn( $a, $b ) => (int) $b['qs'] <=> (int) $a['qs'] ?: (int) $b['total_posts'] <=> (int) $a['total_posts'] );
	}
	foreach ( $rows as $i => &$r ) {
		$r['rank']  = $i + 1;
		$r['q_pct'] = (int) $r['total_posts'] > 0 ? (int) round( 100 * (int) $r['qs'] / (int) $r['total_posts'] ) : null;
	}
	unset( $r );
	return $rows;
}

/** Rows whose f3_name contains $q (any case). Ranks are kept, so a search shows where someone stands. */
function fstats_search_rows( array $rows, $q ) {
	$q = mb_strtolower( trim( (string) $q ) );
	if ( '' === $q ) {
		return $rows;
	}
	return array_values( array_filter( $rows, fn( $r ) => false !== mb_strpos( mb_strtolower( (string) $r['f3_name'] ), $q ) ) );
}

/** AO rows sorted by a column (workouts, pax_posts, unique_pax, avg_pax), largest first. */
function fstats_sort_aos( array $aos, $col = 'pax_posts' ) {
	$col = in_array( $col, array( 'workouts', 'pax_posts', 'unique_pax', 'avg_pax' ), true ) ? $col : 'pax_posts';
	usort( $aos, fn( $a, $b ) => (float) ( $b[ $col ] ?? 0 ) <=> (float) ( $a[ $col ] ?? 0 ) ?: strcmp( (string) $a['ao_name'], (string) $b['ao_name'] ) );
	return $aos;
}

/** The $n months ('YYYY-MM') ending with $today's month, oldest first. */
function fstats_last_months( $today, $n = 12 ) {
	$y   = (int) substr( $today, 0, 4 );
	$m   = (int) substr( $today, 5, 2 );
	$out = array();
	for ( $i = $n - 1; $i >= 0; $i-- ) {
		$t     = gmmktime( 0, 0, 0, $m - $i, 1, $y );
		$out[] = gmdate( 'Y-m', $t );
	}
	return $out;
}

/** array( ao_id => array( 'YYYY-MM' => pax_posts ) ) from ao_monthly_trend. */
function fstats_ao_months( array $ao_monthly ) {
	$out = array();
	foreach ( $ao_monthly as $r ) {
		$out[ $r['ao_id'] ][ $r['month'] ] = (int) $r['pax_posts'];
	}
	return $out;
}

/** Post counts reached, from FSTATS_MILESTONES. */
function fstats_milestones( $posts ) {
	return array_values( array_filter( FSTATS_MILESTONES, fn( $m ) => (int) $posts >= $m ) );
}

/**
 * One PAX from the core payload: their pax_stats row (posts, Qs, co-Qs, AOs visited, first and
 * last post, active months, current and best weekly streak), 'top_aos' and 'ranks'
 * (window => rank on that leaderboard, by posts). Null if unknown.
 */
function fstats_pax_detail( array $core, $user_id ) {
	$user_id = (int) $user_id;
	$row     = null;
	foreach ( $core['pax_stats'] ?? array() as $p ) {
		if ( (int) $p['user_id'] === $user_id ) {
			$row = $p;
			break;
		}
	}
	if ( ! $row ) {
		return null;
	}
	$row['top_aos'] = array_values( array_filter( $core['pax_top_aos'] ?? array(), fn( $r ) => (int) $r['user_id'] === $user_id ) );
	$row['ranks']   = array();
	foreach ( array_keys( FSTATS_RANGES ) as $w ) {
		foreach ( $core['leaderboards'][ $w ] ?? array() as $i => $r ) {
			if ( (int) $r['user_id'] === $user_id ) {
				$row['ranks'][ $w ] = $i + 1;
				break;
			}
		}
	}
	$row['milestones'] = fstats_milestones( $row['total_posts'] );
	return $row;
}

/**
 * One AO from the core payload: its row per window ('windows' => window => row), its monthly
 * PAX posts for the last 12 months ('months'), top attendees per window ('top'), and who has
 * posted most there this year without a Q ('no_q'). Null if unknown.
 */
function fstats_ao_detail( array $core, $ao_id, $today ) {
	$ao_id   = (int) $ao_id;
	$windows = array();
	foreach ( array_keys( FSTATS_RANGES ) as $w ) {
		foreach ( $core['ao_data'][ $w ] ?? array() as $r ) {
			if ( (int) $r['ao_id'] === $ao_id ) {
				$windows[ $w ] = $r;
			}
		}
	}
	if ( empty( $windows['all_time'] ) ) {
		return null;
	}
	$name   = $windows['all_time']['ao_name'];
	$months = fstats_ao_months( $core['ao_monthly_trend'] ?? array() )[ $ao_id ] ?? array();
	$series = array();
	foreach ( fstats_last_months( $today, 12 ) as $m ) {
		$series[ $m ] = $months[ $m ] ?? 0;
	}
	$top = array();
	foreach ( array_keys( FSTATS_RANGES ) as $w ) {
		$top[ $w ] = array_values( array_filter( $core['ao_top_attendees'][ $w ] ?? array(), fn( $r ) => $r['ao_name'] === $name ) );
	}
	$no_q = null;
	foreach ( $core['ao_no_q'] ?? array() as $r ) {
		if ( (int) $r['ao_id'] === $ao_id ) {
			$no_q = $r;
		}
	}
	return array( 'ao_id' => $ao_id, 'ao_name' => $name, 'windows' => $windows, 'months' => $series, 'top' => $top, 'no_q' => $no_q );
}

/**
 * Streak rows (fstats_compute_streaks()) → array( 'active' => top $n by current streak,
 * 'record' => top $n by longest streak ), each row with its 'f3_name'. Unknown PAX are skipped.
 */
function fstats_streak_lists( array $rows, array $names, $n = 25 ) {
	$named = array();
	foreach ( $rows as $r ) {
		if ( isset( $names[ $r['user_id'] ] ) ) {
			$named[] = $r + array( 'f3_name' => $names[ $r['user_id'] ] );
		}
	}
	$active = array_values( array_filter( $named, fn( $r ) => $r['current_streak'] > 0 ) );
	usort( $active, fn( $a, $b ) => $b['current_streak'] <=> $a['current_streak'] ?: $b['max_streak'] <=> $a['max_streak'] );
	$record = $named;
	usort( $record, fn( $a, $b ) => $b['max_streak'] <=> $a['max_streak'] ?: $b['current_streak'] <=> $a['current_streak'] );
	return array( 'active' => array_slice( $active, 0, $n ), 'record' => array_slice( $record, 0, $n ) );
}

/** A value as a percentage of $max (0-100), for bars. */
function fstats_pct( $v, $max ) {
	return $max > 0 ? max( 0, min( 100, round( 100 * (float) $v / (float) $max, 1 ) ) ) : 0;
}

/** 'YYYY-MM' → 'Oct 2026'. */
function fstats_month_label( $m, $long = false ) {
	$t = strtotime( $m . '-01 00:00:00 UTC' );
	return $t ? gmdate( $long ? 'F Y' : 'M Y', $t ) : (string) $m;
}
