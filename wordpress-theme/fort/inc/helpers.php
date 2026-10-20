<?php
/**
 * Small rendering helpers shared by the templates.
 *
 * @package Fort
 */

defined( 'ABSPATH' ) || exit;

/** array( 'dow' => 'TUE', 'mon' => 'OCT', 'day' => 20, 'long' => 'Tuesday, October 20' ) for a YYYY-MM-DD date. */
function fort_date_parts( $iso ) {
	$ts = strtotime( $iso . ' 00:00:00 UTC' );
	if ( ! $ts ) {
		return array( 'dow' => '', 'mon' => '', 'day' => '', 'long' => $iso );
	}
	return array(
		'dow'  => strtoupper( gmdate( 'D', $ts ) ),
		'mon'  => strtoupper( gmdate( 'M', $ts ) ),
		'day'  => (int) gmdate( 'j', $ts ),
		'long' => gmdate( 'l, F j', $ts ),
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

/** Region data (from the homepage payload), cached per request. */
function fort_region() {
	static $region = null;
	if ( null === $region ) {
		$home   = fort_home();
		$region = $home['region'] ?? array();
	}
	return $region;
}

/** AO category URL for a backblast's AO name, if WordPress has that category. */
function fort_ao_url( $ao ) {
	$term = get_term_by( 'name', $ao, 'category' );
	return $term && ! is_wp_error( $term ) ? get_term_link( $term ) : '';
}

/** Parses the "QIC: / When: / Pax:" lines at the top of a backblast post's content. */
function fort_backblast_fields( $content ) {
	// Flatten to one line; each value runs until the next known label.
	$text   = trim( preg_replace( '/\s+/', ' ', html_entity_decode( wp_strip_all_tags( preg_replace( '/<[^>]+>/', ' $0 ', $content ) ) ) ) );
	$labels = 'QIC|When|Pax|Posted In|FNGs?|WARMUP|THE THANG|MARY|ANNOUNCEMENTS|COT';
	$fields = array();
	foreach ( array( 'qic' => 'QIC', 'when' => 'When', 'pax' => 'Pax', 'ao' => 'Posted In' ) as $key => $label ) {
		if ( preg_match( '/\b' . preg_quote( $label, '/' ) . ':\s*(.*?)\s*(?=\b(?:' . $labels . '):|$)/i', $text, $m ) && '' !== $m[1] ) {
			$fields[ $key ] = trim( preg_replace( '/\s*,\s*/', ', ', $m[1] ), ' ,' );
		}
	}
	return $fields;
}

/** The post's AO: its first category other than Uncategorized / Pre-Blast. */
function fort_post_ao() {
	foreach ( get_the_category() as $c ) {
		if ( ! in_array( strtolower( $c->slug ), array( 'uncategorized', 'pre-blast' ), true ) ) {
			return $c;
		}
	}
	return null;
}
