<?php
/**
 * Small rendering helpers shared by the templates.
 *
 * @package Fort
 */

defined( 'ABSPATH' ) || exit;

/**
 * array( 'dow' => 'TUE', 'mon' => 'OCT', 'day' => 20, 'year' => 2026, 'long' => 'Tuesday, October 20',
 * 'short' => 'TUE OCT 20' ) for a YYYY-MM-DD date. Dates in other years carry the year
 * ('Thursday, January 1, 2015', 'JAN 1, 2015').
 */
function fort_date_parts( $iso ) {
	$ts = strtotime( $iso . ' 00:00:00 UTC' );
	if ( ! $ts ) {
		return array( 'dow' => '', 'mon' => '', 'day' => '', 'year' => '', 'long' => (string) $iso, 'short' => '' );
	}
	$this_year = gmdate( 'Y', $ts ) === wp_date( 'Y' );
	return array(
		'dow'   => strtoupper( gmdate( 'D', $ts ) ),
		'mon'   => strtoupper( gmdate( 'M', $ts ) ),
		'day'   => (int) gmdate( 'j', $ts ),
		'year'  => (int) gmdate( 'Y', $ts ),
		'long'  => gmdate( $this_year ? 'l, F j' : 'l, F j, Y', $ts ),
		'short' => strtoupper( gmdate( $this_year ? 'D M j' : 'M j, Y', $ts ) ),
	);
}

/** "0915" or "0515–0600" from an occurrence. */
function fort_time_label( $occ ) {
	if ( empty( $occ['start_time'] ) ) {
		return '';
	}
	return empty( $occ['end_time'] ) ? $occ['start_time'] : $occ['start_time'] . '–' . str_replace( ':', '', $occ['end_time'] );
}

function fort_event_url( $entry ) {
	return home_url( '/events/' . rawurlencode( $entry['slug'] ) . '/' );
}

function fort_submit_url() {
	return home_url( '/submit/' );
}

/** The second accent color (Customizer → Colors). */
function fort_accent2() {
	$c = get_theme_mod( 'fort_accent2', '#8fb4d8' );
	return sanitize_hex_color( $c ) ? $c : '#8fb4d8';
}

/** First tag as a small outlined chip. */
function fort_tag_chip( $entry ) {
	if ( empty( $entry['tags'][0] ) ) {
		return '';
	}
	$t     = $entry['tags'][0];
	$color = sanitize_hex_color( $t['color'] ?? '' ) ?: '#9a9da5';
	return sprintf( '<span class="fort-tag" style="color:%1$s;border-color:%1$s">%2$s</span>', esc_attr( $color ), esc_html( $t['label'] ) );
}

/** "Q: Italian Job · Colosseum" style meta line. */
function fort_entry_meta( $entry, $with_time = false ) {
	$bits = array();
	if ( $with_time && ! empty( $entry['next_occurrence'] ) ) {
		$bits[] = fort_time_label( $entry['next_occurrence'] );
	}
	if ( ! empty( $entry['location'] ) ) {
		$bits[] = $entry['location'];
	}
	if ( ! empty( $entry['leader'] ) ) {
		/* translators: %s: the Q (workout/event leader) */
		$bits[] = sprintf( __( 'Q: %s', 'fort' ), $entry['leader'] );
	}
	return implode( ' · ', array_filter( $bits ) );
}

/** The entry's summary, else a word-boundary excerpt of its description. */
function fort_summary( $entry, $words = 40 ) {
	if ( ! empty( $entry['summary'] ) ) {
		return $entry['summary'];
	}
	return wp_trim_words( wp_strip_all_tags( $entry['description_html'] ?? '' ), $words, '…' );
}

/** Hero image, else the first image in the description. */
function fort_entry_image( $entry ) {
	if ( ! empty( $entry['hero_image'] ) ) {
		return $entry['hero_image'];
	}
	if ( preg_match( '/<img[^>]+src="([^"]+)"/i', $entry['description_html'] ?? '', $m ) ) {
		return $m[1];
	}
	return '';
}

/** Region data (Nan'tan note, Three F's, SLT, links…), cached per request. */
function fort_region() {
	static $region = null;
	if ( null === $region ) {
		$region = function_exists( 'fort_weekly_region' ) ? fort_weekly_region() : array();
	}
	return $region;
}

/** AO category URL for a backblast's AO name, if WordPress has that category. */
function fort_ao_url( $ao ) {
	$term = get_term_by( 'name', $ao, 'category' );
	return $term && ! is_wp_error( $term ) ? get_term_link( $term ) : '';
}

/**
 * A post's tidy backblast record from the Fort Weekly plugin (kind backblast / preblast / post,
 * date, ao, qs, pax, body_html…), or null without the plugin.
 */
function fort_post_bb( $post = null ) {
	return function_exists( 'fortw_post_record' ) ? fortw_post_record( $post ?: get_post() ) : null;
}

/** The post's AO category: the record's AO when the site has that category, else its first real one. */
function fort_post_ao() {
	$r = fort_post_bb();
	if ( ! empty( $r['ao'] ) ) {
		$term = get_term_by( 'name', $r['ao'], 'category' );
		if ( $term && ! is_wp_error( $term ) ) {
			return $term;
		}
	}
	foreach ( get_the_category() as $c ) {
		if ( ! in_array( strtolower( $c->slug ), array( 'uncategorized', 'pre-blast' ), true ) ) {
			return $c;
		}
	}
	return null;
}

/**
 * A backblast's FNGs, from the FNG sign-up sheet only (Fort Stats): sheet entries for that date and
 * AO. Null when unknown (no Fort Stats, no sheet, or no AO), so nothing is shown.
 */
function fort_fng_count( $b ) {
	if ( ! function_exists( 'fort_stats_sheet_fngs' ) ) {
		return null;
	}
	// Stats backblasts already carry the sheet's number; old posts are looked up.
	return empty( $b['post_id'] ) && array_key_exists( 'fng_count', $b ) ? $b['fng_count'] : fort_stats_sheet_fngs( $b['date'] ?? '', $b['ao'] ?? '' );
}

/** A page on this site by slug (e.g. the existing "locations" page), else $fallback. */
function fort_page_url( $slug, $fallback ) {
	$page = get_page_by_path( $slug );
	return ( $page && 'publish' === $page->post_status ) ? get_permalink( $page ) : $fallback;
}

/**
 * The homepage "Who we are" copy. Each piece can be changed in Appearance → Customize → Who we are;
 * the defaults come from the site's existing Mission of F3 and 5 Core Principles pages.
 */
function fort_about_defaults() {
	return array(
		'fort_about_heading' => __( 'Free workouts for men. Rain or shine.', 'fort' ),
		'fort_about_f3'      => __( 'F3 is a free, peer-led workout group for men. Our three Fs stand for Fitness, Fellowship and Faith, and our mission is to plant, grow and serve small workout groups for men for the invigoration of male community leadership.', 'fort' ),
		'fort_about_fort'    => __( 'The Fort is the F3 region for Fort Mill and Tega Cay. We work out six days a week at parks, schools and parking lots around town — boot camps, runs, rucks and gear workouts, most starting at 0515 — and stick around for coffee, lunches and Bible studies in between.', 'fort' ),
		'fort_about_fng'     => __( 'First time? Just show up. No sign-up, no cost, any fitness level. Get there a few minutes early and tell the Q you’re new.', 'fort' ),
	);
}

function fort_about( $key ) {
	$defaults = fort_about_defaults();
	$value    = trim( (string) get_theme_mod( $key, '' ) );
	return '' !== $value ? $value : $defaults[ $key ];
}

function fort_backblast_url( $b ) {
	return home_url( '/backblasts/' . (int) ( is_array( $b ) ? $b['event_id'] : $b ) . '/' );
}

/** The Backblasts archive page, with optional filters (ao, month, type, q, paged). */
function fort_backblasts_url( $args = array() ) {
	return add_query_arg( array_filter( $args ), fort_page_url( 'backblasts', home_url( '/backblasts/' ) ) );
}

/** A backblast's title, or "<AO> beatdown" when it has none. */
function fort_backblast_title( $b ) {
	/* translators: %s: AO name */
	return ! empty( $b['title'] ) ? $b['title'] : sprintf( __( '%s beatdown', 'fort' ), $b['ao'] ?? '' );
}

