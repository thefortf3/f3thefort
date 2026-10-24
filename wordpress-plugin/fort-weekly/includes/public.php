<?php
/**
 * The functions the theme calls. Each returns the same array the newsletter app's public API
 * returned, so templates don't change. Only published, unarchived events appear; never
 * submitter details.
 *
 * @package FortWeekly
 */

defined( 'ABSPATH' ) || exit;

/**
 * Descriptions and the Nan'tan note: filtered like post content, with paragraphs added the way
 * WordPress displays posts (the classic editor saves text without <p> tags).
 */
function fortw_sanitize_html( $html ) {
	return wpautop( wp_kses_post( (string) $html ) );
}

/** The stored region record, with defaults for anything missing. */
function fortw_region_settings() {
	$stored   = get_option( 'fort_weekly_region', array() );
	$defaults = fortw_region_defaults();
	$out      = array();
	foreach ( $defaults as $key => $default ) {
		$value       = is_array( $stored ) && array_key_exists( $key, $stored ) ? $stored[ $key ] : $default;
		$out[ $key ] = is_array( $default ) && ! is_array( $value ) ? $default : $value;
	}
	$out['nantan'] = array_merge( $defaults['nantan'], (array) $out['nantan'] );
	return $out;
}

/** The FNG numbers from the Fort Stats plugin (the sign-up sheet), or null without it. */
function fortw_stats_fng() {
	return function_exists( 'fort_stats_fng' ) ? fort_stats_fng() : null;
}

/** Region info: Nan'tan note, FNG numbers, shovel flags, VQs, Three F's, SLT, links. */
function fort_weekly_region() {
	$settings = fortw_region_settings();
	$image_id = (int) $settings['nantan']['image_id'];
	$image    = $image_id ? wp_get_attachment_image_url( $image_id, 'large' ) : null;
	$today    = fortw_today();
	$region   = fortw_build_region( $settings, $image ? $image : null, fortw_fng_stats( fortw_stats_fng(), $settings['fng_goal'], $today ), 'fortw_sanitize_html' );
	// Every week's 2nd F / 3rd F events as GloomSchedule has them (Fort Stats' stored copy, kept
	// fresh in the background; never fetched while a page loads).
	$map = function_exists( 'fort_stats_map' ) ? fort_stats_map() : null;
	if ( ! empty( $map['configured'] ) ) {
		$aos = array_merge( $map['unplaced'] ?? array(), ...array_map( function ( $s ) { return $s['aos']; }, $map['sites'] ?? array() ) );
		$region['three_fs'] = fortw_every_week_from_schedule( $region['three_fs'], $aos );
	}
	return $region;
}

/** Homepage data: featured, this week, coming up, ongoing, tags, region. */
function fort_weekly_home() {
	$today = fortw_today();
	return fortw_build_home(
		fortw_list_entries( array( 'upcoming_only' => true, 'today' => $today ) ),
		fortw_all_tags(),
		fort_weekly_region(),
		$today,
		'fortw_sanitize_html',
		gmdate( 'c' )
	);
}

/**
 * One event page: array( entry, same_day, related ), or null. $post: a post, id or slug. Only
 * published events, except that editors can preview a pending one they reached through
 * WordPress (which has already checked their permission).
 */
function fort_weekly_entry_page( $post ) {
	$today = fortw_today();
	if ( is_string( $post ) && ! is_numeric( $post ) ) {
		$entry = fortw_entry_by_slug( $post, $today );
	} else {
		$p     = get_post( $post );
		$entry = ( $p && FORTW_POST_TYPE === $p->post_type ) ? fortw_entry( $p, $today ) : null;
		if ( $entry && ! fortw_is_public( $entry ) && ! current_user_can( 'edit_post', $p->ID ) ) {
			$entry = null;
		}
	}
	if ( ! $entry ) {
		return null;
	}
	// The page shows the flyer above the description; don't show it again inside it.
	$copy = $entry['hero_image'] ? fortw_flyer_copy_test( $entry['id'] ) : null;
	if ( $copy ) {
		$entry['description'] = fortw_drop_images( $entry['description'], $copy );
	}
	return fortw_build_entry_page( $entry, fortw_list_entries( array( 'upcoming_only' => true, 'today' => $today ) ), $today, 'fortw_sanitize_html' );
}

/**
 * Event lists. $args: tag (slug), from / to (YYYY-MM-DD: has a date on/after, on/before),
 * include_past (bool), limit (1–200, default 100).
 */
function fort_weekly_entries( $args = array() ) {
	$args    = wp_parse_args( $args, array( 'tag' => '', 'from' => '', 'to' => '', 'include_past' => false, 'limit' => 100 ) );
	$today   = fortw_today();
	$entries = fortw_list_entries( array( 'upcoming_only' => ! $args['include_past'], 'today' => $today ) );
	$tag     = sanitize_title( $args['tag'] );
	$entries = array_values(
		array_filter(
			$entries,
			function ( $e ) use ( $tag, $args ) {
				if ( $tag && ! in_array( $tag, array_column( $e['tags'], 'slug' ), true ) ) {
					return false;
				}
				$dates = array_column( $e['occurrences'], 'date' );
				if ( $args['from'] && ! array_filter( $dates, function ( $d ) use ( $args ) { return $d >= $args['from']; } ) ) {
					return false;
				}
				if ( $args['to'] && ! array_filter( $dates, function ( $d ) use ( $args ) { return $d <= $args['to']; } ) ) {
					return false;
				}
				return true;
			}
		)
	);
	$limit = min( 200, max( 1, (int) $args['limit'] ) );
	return array_map(
		function ( $e ) use ( $today ) {
			return fortw_public_entry( $e, $today, 'fortw_sanitize_html' );
		},
		array_slice( $entries, 0, $limit )
	);
}
