<?php
/**
 * The site's own backblast and pre-blast posts (about 11,800, from 2013 on, written by hand or
 * posted by Slackblast) turned into one tidy record, in the same shape the stats API gives a
 * backblast, so the theme can show both the same way.
 *
 * Where the facts are, by era (from the site's export, October 2026):
 *   - Q and workout date: the `qic` and `workout_date` custom fields (97% of posts); dates in
 *     several formats (10/01/2026, 2026-10-01, 10/01/26, 1/5/15).
 *   - PAX: the `the_pax` field (2014-2017, a comma list with "(FNG)" style markers), then the
 *     post's tags (2017 on).
 *   - AO: the post's categories, which mix AO names in several spellings ("The Colosseum",
 *     "colosseum") with topics ("3rd f", "iron pax challenge 2024") and region-wide posts that
 *     tick every AO.
 *   - Write-up: HTML or Slackblast's labelled plain text (WARMUP: / THE THANG: / MARY: / COT:).
 *
 * Pure functions: includes/legacy-posts.php gathers a post's fields, calls fortw_lp_convert() and
 * finishes the write-up's HTML with WordPress (paragraphs, allowed tags).
 *
 * @package FortWeekly
 */

defined( 'ABSPATH' ) || exit;

/** Bump to have every post converted again (records are rebuilt lazily, on next view). */
define( 'FORTW_LP_VERSION', 1 );

/** Comparison key for AO and category names: lower case, no leading "The", letters and digits. */
function fortw_lp_key( $name ) {
	$k = strtolower( trim( html_entity_decode( (string) $name, ENT_QUOTES, 'UTF-8' ) ) );
	$k = preg_replace( '/^the\s+/', '', $k );
	return preg_replace( '/[^a-z0-9@]+/', '', $k );
}

/**
 * Known AO names, keyed by fortw_lp_key(): today's AOs as the stats data spells them, then
 * retired AOs, then other spellings found in the site's categories.
 */
function fortw_lp_aos() {
	static $map = null;
	if ( null !== $map ) {
		return $map;
	}
	$names = array(
		// Current (stats API).
		'6@6', 'Alcatraz', 'American Jackal', 'Block Party', 'Bushwood', 'Clydesdales', 'Cockpit', 'Colosseum',
		'Currahee', 'Dawn Patrol', 'Flight Plan', 'Hanging with Stang', 'Kitchen Sink', 'Lazarus', 'Minnow Pond',
		'Q Source', 'Ring of Fire', 'Seabiscuit', 'Slow Burn', 'Snake Pit', 'Soul to Sole', 'Sweep the Leg',
		'The Armory', 'The Ballroom', "The Coach's Box", 'The Cyclone', 'The Forge', 'The Fort', 'The Hive',
		'The Ranch', 'The Yard', 'Training Ground', 'Varsity',
		// Retired.
		'Abyss', 'Bermuda Triangle', 'Beyond', 'Cannonball', 'Chupacabra', "Crow's Nest", 'Fire Ant', 'Footloose',
		'G-Fit', 'Golden Corral', 'Honey Badger', 'JOC', 'Laces In', 'Laces Out', 'Matterhorn', 'Mettle Forger',
		'Millllkshake', 'Pantheon', 'Pathfinder', 'Poopdeck', 'Quagmire', 'RPG', "Run 'n Gun", 'Sea Legs',
		'Spoke and Mirrors', 'Tallawah', 'Tempo', 'The Bubble', 'The Deep', 'The Reservation', 'The Stockade',
		'The Swamp', 'Tomahawk', 'Virile Agitur',
	);
	$map = array();
	foreach ( $names as $n ) {
		$map[ fortw_lp_key( $n ) ] = $n;
	}
	$aliases = array(
		'6at6'          => '6@6',
		'americanjackle' => 'American Jackal',
		'coachsbox'     => "The Coach's Box",
		'cyclonechester' => 'The Cyclone',
		'qsource'       => 'Q Source',
		'crowsnest'     => "Crow's Nest",
	);
	return $map = $aliases + $map;
}

/** Categories that are neither an AO nor a topic worth showing. */
function fortw_lp_ignored_category( $key ) {
	return in_array( $key, array( 'uncategorized', 'preblast', 'backblast', 'backblasts', 'general' ), true );
}

/**
 * Sorts a post's categories into its AO(s) and topics. Posts that tick more than three AOs are
 * region-wide announcements: no AO. "The Fort" is both the region and an AO, so it only counts as
 * the AO when nothing more specific is ticked.
 *
 * @return array{aos: string[], topics: string[]}
 */
function fortw_lp_categories( array $categories ) {
	$known = fortw_lp_aos();
	$aos   = array();
	$topic = array();
	foreach ( $categories as $c ) {
		$c   = trim( html_entity_decode( (string) $c, ENT_QUOTES, 'UTF-8' ) );
		$key = fortw_lp_key( $c );
		if ( '' === $key || fortw_lp_ignored_category( $key ) ) {
			continue;
		}
		if ( isset( $known[ $key ] ) ) {
			$aos[ $known[ $key ] ] = true;
		} elseif ( preg_match( '/\(AO ([^)]+)\)/i', $c, $m ) && isset( $known[ fortw_lp_key( $m[1] ) ] ) ) {
			$aos[ $known[ fortw_lp_key( $m[1] ) ] ] = true; // "Nation Ford HS Football Field (AO Ring of Fire) - …"
		} elseif ( strlen( $c ) <= 40 ) {
			$topic[ $key ] = fortw_lp_topic_name( $c );
		}
	}
	$aos = array_keys( $aos );
	if ( count( $aos ) > 1 ) {
		$aos = array_values( array_diff( $aos, array( 'The Fort' ) ) );
	}
	if ( count( $aos ) > 3 ) {
		$aos = array();
	}
	return array( 'aos' => $aos, 'topics' => array_values( $topic ) );
}

/** "3rd f" → "3rd F", "iron pax" → "Iron Pax"; names already capitalised are kept. */
function fortw_lp_topic_name( $c ) {
	if ( preg_match( '/[A-Z]/', $c ) ) {
		return $c;
	}
	return preg_replace_callback( '/\b([a-z])/', function ( $m ) { return strtoupper( $m[1] ); }, $c );
}

/**
 * A workout date as Y-m-d, from "10/01/2026", "2026-10-01", "10/01/26" or "1/5/15". Null when it
 * can't be read, or when it is more than a year away from the post date (a typo'd year).
 */
function fortw_lp_date( $raw, $posted ) {
	$raw = trim( (string) $raw );
	$y   = $m = $d = 0;
	if ( preg_match( '/^(\d{4})-(\d{1,2})-(\d{1,2})/', $raw, $x ) ) {
		list( , $y, $m, $d ) = $x;
	} elseif ( preg_match( '/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/', $raw, $x ) ) {
		list( , $m, $d, $y ) = $x;
		$y = strlen( $y ) === 2 ? 2000 + (int) $y : $y;
	}
	if ( ! $y || ! checkdate( (int) $m, (int) $d, (int) $y ) ) {
		return null;
	}
	$date = sprintf( '%04d-%02d-%02d', $y, $m, $d );
	if ( $posted && abs( strtotime( $date . ' 00:00:00 UTC' ) - strtotime( substr( $posted, 0, 10 ) . ' 00:00:00 UTC' ) ) > 366 * 86400 ) {
		return null;
	}
	return $date;
}

/**
 * Names from a Q or PAX list: "Stang & Poppins", "Red Eye, Slim Jim, FNG - Professor",
 * "Marky Mark (FNG), Spitz, & Trucker (FIFO)", or HTML with line breaks. FNG markers are counted
 * and removed, other notes in brackets are dropped, duplicates are removed.
 *
 * @return array{names: string[], fngs: int}
 */
function fortw_lp_names( $raw ) {
	$text = html_entity_decode( strip_tags( preg_replace( '/<br\s*\/?>|<\/p>|<\/li>/i', ',', (string) $raw ) ), ENT_QUOTES, 'UTF-8' );
	$text = str_replace( "\xc2\xa0", ' ', $text );
	$fngs = 0;
	$out  = array();
	foreach ( preg_split( '/\s*(?:[,;\n\/+&]|\band\b)\s*/i', $text ) as $n ) {
		$is_fng = (bool) preg_match( '/\bFNGs?\b/i', $n );
		$n      = preg_replace( '/\([^)]*\)|\[[^\]]*\]|\bFNGs?\b\s*[-:#]?\s*/i', ' ', $n );
		$n      = trim( preg_replace( '/\s+/', ' ', $n ), " \t.-:" );
		if ( '' === $n || mb_strlen( $n ) > 40 ) {
			continue;
		}
		$fngs += $is_fng ? 1 : 0;
		$out[ mb_strtolower( $n ) ] = $out[ mb_strtolower( $n ) ] ?? $n;
	}
	return array( 'names' => array_values( $out ), 'fngs' => $fngs );
}

/**
 * Section labels in write-ups, and how they're shown. Matched at the start of a line, before a
 * colon, in any case and optionally bold.
 */
function fortw_lp_labels() {
	return array(
		'WARM[- ]?UP'                                 => 'Warm-up',
		'(?:THE )?THANG'                              => 'The Thang',
		'MARY'                                        => 'Mary',
		'ANNOUNCEMENTS'                               => 'Announcements',
		'(?:NMM|NAKED MAN MOLESKIN|MOLESKIN)'         => 'Moleskin',
		'(?:PRAYERS?(?: AND PRAISES| REQUESTS)?)'     => 'Prayers',
		'COT'                                         => 'COT',
		'COP'                                         => 'COP',
	);
}

/**
 * The write-up, tidied for the theme: no inline colours or fonts (they were picked for a white
 * page), no empty "&nbsp;" lines, no repeated "QIC:" / "PAX:" lines on backblasts (shown above the
 * write-up instead), and Slackblast's section labels as headings. Paragraphs and allowed-tag
 * filtering are added by WordPress afterwards.
 */
function fortw_lp_body( $html, $kind = 'backblast' ) {
	$html = str_replace( array( "\r\n", "\r" ), "\n", (string) $html );
	// Inline styling: colours, fonts, sizes.
	$html = preg_replace( '/\s(?:style|color|face|size)="[^"]*"/i', '', $html );
	$html = preg_replace( '/<\/?(?:font|span)\b[^>]*>/i', '', $html );
	// Empty lines and paragraphs.
	$html = preg_replace( '/<p>(?:\s|&nbsp;|\xc2\xa0|<br\s*\/?>)*<\/p>/i', '', $html );
	$html = preg_replace( '/^(?:\s|&nbsp;|\xc2\xa0)+$/m', '', $html );
	if ( 'preblast' !== $kind ) {
		$html = preg_replace( '/(^|\n|<br\s*\/?>)\s*(?:<(?:strong|b)>\s*)?(?:QIC|PAX)\s*:(?:\s*<\/(?:strong|b)>)?[^\n<]*(?:<br\s*\/?>)?/i', '$1', $html );
	}
	foreach ( fortw_lp_labels() as $re => $label ) {
		$html = preg_replace(
			'/(^|\n|<br\s*\/?>|<p>)\s*(?:<(?:strong|b)>\s*)?' . $re . '\s*:\s*(?:<\/(?:strong|b)>\s*)?(?:<br\s*\/?>\s*)?/i',
			"\$1\n\n<h3 class=\"fort-bb-label\">" . $label . "</h3>\n\n",
			$html
		);
	}
	// A line break left right before a heading.
	$html = preg_replace( '/<br\s*\/?>\s*(\n\n<h3 class="fort-bb-label">)/i', '$1', $html );
	return trim( preg_replace( "/\n{3,}/", "\n\n", $html ) );
}

/** Plain-text summary of a write-up, about $max characters, labels removed. */
function fortw_lp_excerpt( $html, $max = 220 ) {
	$text = preg_replace( '/<h3 class="fort-bb-label">[^<]*<\/h3>/', ' ', (string) $html );
	$text = trim( preg_replace( '/\s+/', ' ', html_entity_decode( strip_tags( preg_replace( '/<[^>]+>/', ' $0', $text ) ), ENT_QUOTES, 'UTF-8' ) ) );
	if ( mb_strlen( $text ) <= $max ) {
		return $text;
	}
	$cut = mb_substr( $text, 0, $max );
	$sp  = mb_strrpos( $cut, ' ' );
	return rtrim( $sp > $max * 0.6 ? mb_substr( $cut, 0, $sp ) : $cut, ' ,.;:' ) . '…';
}

/**
 * One post as a backblast record.
 *
 * @param array $p {title, post_date (Y-m-d H:i:s), content, categories: string[], tags: string[],
 *                 meta: {qic?, workout_date?, the_pax?}}
 * @return array {v, source, kind (backblast|preblast|post), title, date, posted, ao, aos, topics,
 *               qs, coqs, pax, pax_count, fng_count, body_html, excerpt}
 */
function fortw_lp_convert( array $p ) {
	$meta   = $p['meta'] ?? array();
	$posted = substr( (string) ( $p['post_date'] ?? '' ), 0, 10 );
	$title  = trim( html_entity_decode( (string) ( $p['title'] ?? '' ), ENT_QUOTES, 'UTF-8' ) );
	$cats   = fortw_lp_categories( $p['categories'] ?? array() );
	$qs     = fortw_lp_names( $meta['qic'] ?? '' );
	$pax    = fortw_lp_names( '' !== trim( (string) ( $meta['the_pax'] ?? '' ) ) ? $meta['the_pax'] : implode( ',', $p['tags'] ?? array() ) );

	$is_pre = (bool) preg_match( '/pre-?blast/i', $title );
	foreach ( $p['categories'] ?? array() as $c ) {
		$is_pre = $is_pre || 'preblast' === fortw_lp_key( $c );
	}
	$content = (string) ( $p['content'] ?? '' );
	$labels  = (bool) preg_match( '/(?:^|\n|>)\s*(?:WARM[- ]?UP|THE THANG|COT)\s*:/i', $content );
	$kind    = $is_pre ? 'preblast' : ( ( $qs['names'] || $labels || $pax['names'] ) ? 'backblast' : 'post' );

	// The Q(s) count as PAX (the old instructions asked for them in the list, not everyone did).
	$names = $pax['names'];
	if ( 'backblast' === $kind ) {
		$have = array_map( 'mb_strtolower', $names );
		foreach ( array_reverse( $qs['names'] ) as $q ) {
			if ( ! in_array( mb_strtolower( $q ), $have, true ) ) {
				array_unshift( $names, $q );
			}
		}
	}

	$date = fortw_lp_date( $meta['workout_date'] ?? '', 'preblast' === $kind ? '' : $posted );
	$body = fortw_lp_body( $content, $kind );
	return array(
		'v'         => FORTW_LP_VERSION,
		'source'    => 'post',
		'kind'      => $kind,
		'title'     => $title,
		'date'      => $date ?: ( 'preblast' === $kind ? null : ( $posted ?: null ) ),
		'posted'    => $posted ?: null,
		'ao'        => $cats['aos'][0] ?? null,
		'aos'       => $cats['aos'],
		'topics'    => $cats['topics'],
		'qs'        => $qs['names'],
		'coqs'      => array(),
		'pax'       => 'backblast' === $kind ? $names : array(),
		'pax_count' => 'backblast' === $kind ? count( $names ) : 0,
		'fng_count' => 'backblast' === $kind ? $pax['fngs'] : 0,
		'body_html' => $body,
		'excerpt'   => fortw_lp_excerpt( $body ),
	);
}
