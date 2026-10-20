<?php
/**
 * What visitors see: the public shape of entries, the homepage and region info. Port of
 * publicEntry(), buildHome() and buildRegion() in the newsletter app's lib/public-api.js, so the
 * theme gets exactly the arrays it got from the app's /api/public/* endpoints.
 *
 * Never includes submitter details; links that aren't http(s) are dropped. $sanitize is the HTML
 * filter for descriptions (wp_kses_post in WordPress), passed in so these stay testable.
 *
 * @package FortWeekly
 */

defined( 'ABSPATH' ) || defined( 'FORTW_TESTING' ) || exit;

function fortw_is_http_url( $url ) {
	return is_string( $url ) && preg_match( '#^https?://#i', $url );
}

function fortw_public_entry( $e, $today, $sanitize ) {
	$occ = $e['occurrences'];
	return array(
		'id'               => $e['id'],
		'slug'             => $e['slug'],
		'title'            => $e['title'],
		'leader'           => $e['leader'] ? $e['leader'] : null,
		'location'         => $e['location'] ? $e['location'] : null,
		'summary'          => $e['summary'] ? $e['summary'] : null,
		'description_html' => call_user_func( $sanitize, (string) $e['description'] ),
		'hero_image'       => $e['hero_image'] ? $e['hero_image'] : null,
		'link'             => fortw_is_http_url( $e['link'] ) ? $e['link'] : null,
		'video_url'        => fortw_is_http_url( $e['video_url'] ) ? $e['video_url'] : null,
		'preblast_url'     => fortw_is_http_url( $e['preblast_url'] ) ? $e['preblast_url'] : null,
		'featured'         => (bool) $e['featured'],
		'tags'             => array_map( function ( $t ) { return array( 'label' => $t['label'], 'slug' => $t['slug'], 'color' => $t['color'] ); }, $e['tags'] ),
		'occurrences'      => $occ,
		'next_occurrence'  => $e['next_occurrence'] ? $e['next_occurrence'] : null,
		'upcoming_dates'   => fortw_upcoming_dates( $occ, $today ),
		'is_past'          => $occ && ! $e['next_occurrence'],
	);
}

function fortw_is_public( $e ) {
	return 'approved' === $e['status'] && empty( $e['archived'] );
}

/**
 * The homepage: featured, this week (by day), coming up, ongoing, the tags in use, region info.
 * The site shows held entries; holding only affects the newsletter.
 */
function fortw_build_home( $entries, $tags, $region, $today, $sanitize, $generated_at ) {
	$public = array_map(
		function ( $e ) {
			$e['hold_from_newsletter'] = false;
			return $e;
		},
		array_values( array_filter( $entries, 'fortw_is_public' ) )
	);
	$sel = fortw_select_agenda( $public, $today );
	$pub = function ( $e ) use ( $today, $sanitize ) {
		return fortw_public_entry( $e, $today, $sanitize );
	};
	return array(
		'generated_at' => $generated_at,
		'today'        => $today,
		'range'        => $sel['range'],
		'featured'     => $sel['featured'] ? $pub( $sel['featured'] ) : null,
		'this_week'    => array_map( function ( $d ) use ( $pub ) { return array( 'date' => $d['date'], 'entries' => array_map( $pub, $d['entries'] ) ); }, $sel['this_week'] ),
		'coming_up'    => array_map( $pub, $sel['coming_up'] ),
		'ongoing'      => array_map( $pub, $sel['ongoing'] ),
		'tags'         => array_values( array_map( function ( $t ) { return array( 'label' => $t['label'], 'slug' => $t['slug'], 'color' => $t['color'] ); }, array_filter( $tags, function ( $t ) { return $t['count'] > 0; } ) ) ),
		'region'       => $region,
	);
}

/**
 * One entry page: the entry, other upcoming entries on its next date, and up to four more that
 * share a tag. $others: every public entry (any order); $entry is excluded from both lists.
 */
function fortw_build_entry_page( $entry, $others, $today, $sanitize ) {
	$others   = array_values( array_filter( $others, function ( $x ) use ( $entry ) { return fortw_is_public( $x ) && $x['id'] !== $entry['id'] && $x['next_occurrence']; } ) );
	$next     = $entry['next_occurrence'];
	$same_day = $next ? array_values( array_filter( $others, function ( $x ) use ( $next ) { return $x['next_occurrence']['date'] === $next['date']; } ) ) : array();
	$day_ids  = array_column( $same_day, 'id' );
	$tag_ids  = array_column( $entry['tags'], 'id' );
	$same_tag = array_values(
		array_filter(
			$others,
			function ( $x ) use ( $day_ids, $tag_ids ) {
				return ! in_array( $x['id'], $day_ids, true ) && array_intersect( array_column( $x['tags'], 'id' ), $tag_ids );
			}
		)
	);
	$pub = function ( $e ) use ( $today, $sanitize ) {
		return fortw_public_entry( $e, $today, $sanitize );
	};
	return array(
		'entry'    => $pub( $entry ),
		'same_day' => array_map( $pub, array_slice( $same_day, 0, 4 ) ),
		'related'  => array_map( $pub, array_slice( $same_tag, 0, 4 ) ),
	);
}

/**
 * The FNG numbers for this year, from the stats API's /api/fng payload.
 * weekly: the F3 names of FNGs whose first post was this week (Monday–Sunday).
 */
function fortw_fng_stats( $fng, $goal, $today ) {
	if ( ! is_array( $fng ) || ! isset( $fng['ytd'] ) ) {
		return array( 'stats' => null, 'weekly' => array() );
	}
	$dow    = (int) gmdate( 'N', strtotime( $today . ' 00:00:00 UTC' ) ); // 1 = Monday.
	$monday = fortw_add_days( $today, 1 - $dow );
	$sunday = fortw_add_days( $monday, 6 );
	$weekly = array();
	foreach ( (array) ( $fng['recent'] ?? array() ) as $r ) {
		$d = substr( (string) ( $r['date'] ?? '' ), 0, 10 );
		if ( $d >= $monday && $d <= $sunday && ! empty( $r['f3_name'] ) ) {
			$weekly[] = (string) $r['f3_name'];
		}
	}
	return array(
		'stats'  => array(
			'total'        => (int) $fng['ytd'],
			'goal'         => (int) $goal,
			'days_elapsed' => (int) gmdate( 'z', strtotime( $today . ' 00:00:00 UTC' ) ) + 1,
			'year'         => (int) substr( $today, 0, 4 ),
		),
		'weekly' => $weekly,
	);
}

/**
 * Region info for the site and newsletter. $settings: the stored region option (see
 * fortw_region_defaults()); $nantan_image: the note's image URL or null; $fng: fortw_fng_stats().
 */
function fortw_build_region( $settings, $nantan_image, $fng, $sanitize ) {
	$n      = $settings['nantan'];
	$nantan = trim( (string) $n['text'] ) !== ''
		? array( 'text_html' => call_user_func( $sanitize, $n['text'] ), 'author' => (string) $n['author'], 'heading' => (string) $n['heading'], 'image' => $nantan_image )
		: null;
	$three  = array();
	foreach ( array( 'fitness', 'fellowship', 'faith' ) as $col ) {
		$items = array();
		foreach ( $settings['three_fs'] as $i ) {
			if ( $i['column'] !== $col ) {
				continue;
			}
			$items[] = 'link' === $i['type']
				? array( 'type' => 'link', 'label' => $i['label'], 'url' => $i['url'] )
				: array( 'type' => 'event', 'name' => $i['name'], 'detail' => $i['detail'] );
		}
		$three[] = array( 'column' => $col, 'items' => $items );
	}
	return array(
		'nantan'       => $nantan,
		'fng_stats'    => $fng['stats'],
		'weekly_fngs'  => $fng['weekly'],
		'shovel_flags' => array_map( function ( $s ) { return array( 'from' => $s['from'], 'to' => $s['to'], 'ao' => $s['ao'] ); }, $settings['shovel_flags'] ),
		'vqs'          => array_map( function ( $v ) { return array( 'name' => $v['name'], 'ao' => $v['ao'] ); }, $settings['vqs'] ),
		'three_fs'     => $three,
		'slt'          => array_map( function ( $s ) { return array( 'role' => $s['role'], 'name' => $s['name'] ); }, $settings['slt'] ),
		'links'        => array_map( function ( $l ) { return array( 'label' => $l['label'], 'name' => $l['name'], 'url' => $l['url'] ); }, $settings['links'] ),
	);
}

/** An empty region record: the shape stored in the fort_weekly_region option. */
function fortw_region_defaults() {
	return array(
		'nantan'       => array( 'text' => '', 'author' => '', 'heading' => '', 'image_id' => 0 ),
		'three_fs'     => array(), // [{column: fitness|fellowship|faith, type: event|link, name, detail, label, url}]
		'slt'          => array(), // [{role, name}]
		'links'        => array(), // [{label, name, url}]
		'shovel_flags' => array(), // [{from, to, ao}]
		'vqs'          => array(), // [{name, ao}]
		'fng_goal'     => 226,
	);
}
