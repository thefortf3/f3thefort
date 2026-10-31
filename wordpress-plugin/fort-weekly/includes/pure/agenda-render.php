<?php
/**
 * The Fort Weekly "agenda" issue (design canvas E3): masthead and the region's week, the Nan'tan's note,
 * one featured event, then every upcoming approved event as a dated agenda (This week / Coming
 * up / Ongoing), the Every-week line and the footer. Port of renderAgenda() and its helpers in
 * the newsletter app's lib/newsletter-agenda.js. Text is written in normal case and the template
 * capitalizes it (text-transform), so a restyle can drop the capitals: email can't re-case text
 * any other way.
 *
 * Pure: takes entry arrays and the region array (fort_weekly_region() shape) and returns HTML.
 *
 * @package FortWeekly
 */

defined( 'ABSPATH' ) || defined( 'FORTW_TESTING' ) || exit;

function fortw_h( $s ) {
	return htmlspecialchars( (string) $s, ENT_COMPAT, 'UTF-8' ); // & < > " — as the app's escapeHtml().
}

/** Plain text from HTML, whitespace collapsed (the app's textOf()). */
function fortw_text_of( $html ) {
	$t = preg_replace( '/<[^>]*>/', ' ', (string) $html );
	$t = str_replace( array( '&nbsp;', '&amp;', '&lt;', '&gt;', '&quot;', '&#39;' ), array( ' ', '&', '<', '>', '"', "'" ), $t );
	return trim( preg_replace( '/\s+/u', ' ', $t ) );
}

/** The entry's summary, or a trimmed excerpt of its description, cut on a word boundary. */
function fortw_summary_of( $entry, $max = 260 ) {
	$s = trim( (string) ( $entry['summary'] ?? '' ) );
	if ( '' === $s ) {
		$s = fortw_text_of( $entry['description'] ?? '' );
	}
	return fortw_cut_words( $s, $max );
}

/** $s cut to $max characters on a word boundary, with "…" when anything was cut. */
function fortw_cut_words( $s, $max ) {
	if ( mb_strlen( $s ) <= $max ) {
		return $s;
	}
	$cut   = mb_substr( $s, 0, $max );
	$space = mb_strrpos( $cut, ' ' );
	$cut   = mb_substr( $cut, 0, max( false === $space ? -1 : $space, $max - 20 ) );
	return preg_replace( '/[\s,.;:—-]+$/u', '', $cut ) . '…';
}

/**
 * The featured card's write-up: the entry's description as plain paragraphs (list items as
 * "• …"), at most $paras of them and $max characters in all, the last cut on a word boundary.
 * Email can't clamp lines, so the cut happens here; Details links to the rest. Falls back to the
 * summary when there's no description.
 */
function fortw_writeup_of( $entry, $max = 320, $paras = 3 ) {
	$html = preg_replace( '/<li\b[^>]*>/i', "\n• ", (string) ( $entry['description'] ?? '' ) );
	$html = preg_replace( '#<br\s*/?>|</(p|div|h[1-6]|li|ul|ol|blockquote)>#i', "\n", $html );
	$all  = array_values( array_filter( array_map( 'fortw_text_of', explode( "\n", $html ) ), 'strlen' ) );
	if ( ! $all ) {
		$s = fortw_summary_of( $entry, $max );
		return '' === $s ? array() : array( $s );
	}
	$out  = array();
	$left = $max;
	foreach ( array_slice( $all, 0, $paras ) as $p ) {
		// Not a stub of a paragraph at the end: stop instead.
		if ( $out && $left < 60 ) {
			break;
		}
		$out[] = fortw_cut_words( $p, $left );
		$left -= mb_strlen( $p );
		if ( $left <= 0 ) {
			break;
		}
	}
	return $out;
}

/** A thumbnail: the hero image, else the first image in the description. */
function fortw_image_of( $entry ) {
	if ( ! empty( $entry['hero_image'] ) ) {
		return $entry['hero_image'];
	}
	return preg_match( '/<img[^>]+src="([^"]+)"/i', (string) ( $entry['description'] ?? '' ), $m ) ? $m[1] : null;
}

/** "TUE" / "OCT" (fortw_date_parts()) → "Tue" / "Oct". */
function fortw_nl_word( $s ) {
	return ucfirst( strtolower( (string) $s ) );
}

function fortw_nl_tag_chip( $e ) {
	$t = $e['tags'][0] ?? null;
	if ( ! $t ) {
		return '';
	}
	$c = fortw_h( $t['color'] ? $t['color'] : '#9a9da5' );
	return '<span class="tag" style="color:' . $c . ';border-color:' . $c . '">' . fortw_h( $t['label'] ) . '</span>';
}

function fortw_nl_time( $occ ) {
	if ( empty( $occ['start_time'] ) ) {
		return '';
	}
	return $occ['end_time'] ? $occ['start_time'] . '–' . preg_replace( '/:/', '', $occ['end_time'], 1 ) : $occ['start_time'];
}

/** "Through Sat Nov 22" for something that runs over several days, else ''. */
function fortw_nl_through( $occ ) {
	if ( empty( $occ['end_date'] ) ) {
		return '';
	}
	$p = fortw_date_parts( $occ['end_date'] );
	return 'Through ' . fortw_nl_word( $p['dow'] ) . ' ' . fortw_nl_word( $p['mon'] ) . ' ' . $p['day'];
}

/** The time and, for a multi-day one, its last day: "0600 · Through Sat Nov 22". */
function fortw_nl_when( $occ ) {
	return implode( ' · ', array_filter( array( fortw_nl_time( $occ ), fortw_nl_through( $occ ) ), 'strlen' ) );
}

function fortw_nl_also( $dates ) {
	if ( ! $dates ) {
		return '';
	}
	$shown = array_map(
		function ( $d ) {
			$p = fortw_date_parts( $d );
			return fortw_nl_word( $p['mon'] ) . ' ' . $p['day'];
		},
		array_slice( $dates, 0, 3 )
	);
	return '<div class="also">Also ' . fortw_h( implode( ', ', $shown ) ) . ( count( $dates ) > 3 ? ' +' . ( count( $dates ) - 3 ) . ' more' : '' ) . '</div>';
}

/**
 * "Add to calendar ↗" for an event with a date: to its page's calendar buttons (an email can't
 * tell an iPhone from an Android to pick the right one itself). '' for an ongoing event.
 */
function fortw_nl_cal_link( $e, $ctx ) {
	return empty( $e['next_occurrence'] ) ? '' : '<a class="lnk" href="' . fortw_h( $ctx['entry_url']( $e ) . '#add-to-calendar' ) . '">Add to calendar ↗</a>';
}

function fortw_nl_links( $e, $ctx ) {
	$out = array_filter( array( '<a class="lnk" href="' . fortw_h( $ctx['entry_url']( $e ) ) . '">Details ↗</a>', fortw_nl_cal_link( $e, $ctx ) ) );
	if ( ! empty( $e['preblast_url'] ) ) {
		$out[] = '<a class="lnk" href="' . fortw_h( $e['preblast_url'] ) . '">Pre-blast ↗</a>';
	}
	if ( fortw_is_http_url( $e['link'] ?? '' ) ) {
		$out[] = '<a class="lnk" href="' . fortw_h( $e['link'] ) . '">Link ↗</a>';
	}
	return '<div class="links">' . implode( '<span class="sp"> </span>', $out ) . '</div>';
}

function fortw_nl_meta( $parts ) {
	return implode( ' · ', array_filter( $parts, 'strlen' ) );
}

/**
 * A location as a link in the newsletter's own link colour, so mail apps (Gmail, Apple Mail) don't
 * turn the address into their own blue link; it opens the place in Maps. To the URL in the
 * location if it has one (the URL isn't shown: "Print Shop: https://maps.app…" reads "Print
 * Shop"), else a Google Maps search for it. HTML, escaped.
 */
function fortw_nl_place( $location ) {
	$location = trim( (string) $location );
	if ( '' === $location ) {
		return '';
	}
	if ( preg_match( '#https?://[^\s<>"]+#i', $location, $m ) ) {
		$href = rtrim( $m[0], '.,;)' );
		$text = trim( preg_replace( '/\s+/', ' ', str_replace( $m[0], ' ', $location ) ), " \t-:–—,;" );
		$text = '' === $text ? 'Map' : $text;
	} else {
		$href = 'https://www.google.com/maps/search/?api=1&query=' . rawurlencode( $location );
		$text = $location;
	}
	return '<a class="place" href="' . fortw_h( $href ) . '">' . fortw_h( $text ) . '</a>';
}

/** An event's details as HTML, one a line: $before (plain text, e.g. the time), its place (a link, see above) and Q. */
function fortw_nl_meta_html( $e, $before = array() ) {
	$parts   = array_map( 'fortw_h', array_filter( $before, 'strlen' ) );
	$parts[] = fortw_nl_place( $e['location'] ?? '' );
	$parts[] = ! empty( $e['leader'] ) ? fortw_h( 'Q: ' . $e['leader'] ) : '';
	return implode( '<br>', array_filter( $parts, 'strlen' ) );
}

/** The featured entry in the date list: its time and title, linking to its page (it's in full above). */
function fortw_nl_featured_line( $e, $ctx, $time ) {
	return '<div class="item"><div class="when">' . fortw_h( $time ) . '<span class="new">Featured</span></div>
        <a class="title" href="' . fortw_h( $ctx['entry_url']( $e ) ) . '">' . fortw_h( $e['title'] ) . '</a></div>';
}

function fortw_nl_week_entry( $e, $ctx ) {
	if ( ! empty( $e['featured'] ) ) {
		return fortw_nl_featured_line( $e, $ctx, fortw_nl_when( $e['next_occurrence'] ) );
	}
	$img  = fortw_image_of( $e );
	$meta = fortw_nl_meta_html( $e );
	$url  = fortw_h( $ctx['entry_url']( $e ) );
	$body = '
        <div class="when">' . fortw_h( fortw_nl_when( $e['next_occurrence'] ) ) . fortw_nl_tag_chip( $e ) . ( $e['is_new'] ? '<span class="new">New</span>' : '' ) . '</div>
        <a class="title" href="' . $url . '">' . fortw_h( $e['title'] ) . '</a>
        ' . ( '' !== $meta ? '<div class="meta">' . $meta . '</div>' : '' ) . '
        <p class="sum">' . fortw_h( fortw_summary_of( $e ) ) . '</p>
        ' . fortw_nl_also( $e['also'] ) . '
        ' . fortw_nl_links( $e, $ctx );
	return '<div class="item">' . fortw_nl_with_flyer( $body, $img ? '<a href="' . $url . '"><img class="thumb" src="' . fortw_h( $img ) . '" width="120" alt="' . fortw_h( $e['title'] ) . ' flyer"></a>' : '', 132 ) . '</div>';
}

/**
 * A "Don't miss" entry: as in This week (the same size and parts), on its own panel with the
 * accent edge, and with its date in the top line since it isn't under a day.
 */
function fortw_nl_dont_miss_entry( $e, $ctx ) {
	$next = $e['next_occurrence'];
	$day  = '';
	if ( $next ) {
		$p   = fortw_date_parts( $next['date'] );
		$day = fortw_nl_word( $p['dow'] ) . ' ' . fortw_nl_word( $p['mon'] ) . ' ' . $p['day'];
	}
	$img  = fortw_image_of( $e );
	$meta = fortw_nl_meta_html( $e );
	$url  = fortw_h( $ctx['entry_url']( $e ) );
	$body = '
        <div class="when dm-when">' . fortw_h( $next ? fortw_nl_meta( array( $day, fortw_nl_when( $next ) ) ) : 'Ongoing' ) . fortw_nl_tag_chip( $e ) . ( $e['is_new'] ? '<span class="new">New</span>' : '' ) . '</div>
        <a class="title" href="' . $url . '">' . fortw_h( $e['title'] ) . '</a>
        ' . ( '' !== $meta ? '<div class="meta">' . $meta . '</div>' : '' ) . '
        <p class="sum">' . fortw_h( fortw_summary_of( $e ) ) . '</p>
        ' . fortw_nl_also( $e['also'] ) . '
        ' . fortw_nl_links( $e, $ctx );
	return '
    <table role="presentation" class="dm" width="100%"><tr><td class="dm-cell">' . fortw_nl_with_flyer( $body, $img ? '<a href="' . $url . '"><img class="thumb" src="' . fortw_h( $img ) . '" width="120" alt="' . fortw_h( $e['title'] ) . ' flyer"></a>' : '', 132 ) . '</td></tr></table>';
}

/**
 * $body with its flyer ($flyer: the linked <img>, or '') to the right, as on the homepage: two
 * real cells, which the phone layout stacks so the text keeps the width (the Featured card's way;
 * Gmail Android lets @media override a <td>'s layout, not inline CSS).
 */
function fortw_nl_with_flyer( $body, $flyer, $width ) {
	if ( '' === $flyer ) {
		return $body;
	}
	return '<table role="presentation" class="split" width="100%"><tr>
        <td class="split-main" valign="top">' . $body . '</td>
        <td class="split-thumb" valign="top" width="' . (int) $width . '">' . $flyer . '</td>
      </tr></table>';
}

function fortw_nl_day( $day, $ctx ) {
	$p = fortw_date_parts( $day['date'] );
	return '
    <table role="presentation" class="day" width="100%"><tr>
      <td class="day-label" valign="top" width="52"><div class="dow">' . fortw_nl_word( $p['dow'] ) . '</div><div class="dnum">' . $p['day'] . '</div></td>
      <td class="day-items" valign="top">' . implode( '', array_map( function ( $e ) use ( $ctx ) { return fortw_nl_week_entry( $e, $ctx ); }, $day['entries'] ) ) . '</td>
    </tr></table>';
}

/** A row in Coming up, or in Happening now (where the date shown is its last day). */
function fortw_nl_coming( $e, $ctx ) {
	$p    = fortw_date_parts( ! empty( $e['running'] ) ? $e['next_occurrence']['end_date'] : $e['next_occurrence']['date'] );
	$meta = fortw_nl_meta_html( $e, array( fortw_nl_when( $e['next_occurrence'] ) ) );
	$url  = fortw_h( $ctx['entry_url']( $e ) );
	if ( ! empty( $e['featured'] ) || ! empty( $e['called_out'] ) ) { // In full above: here just its title, time and place.
		$chips = '<span class="new">' . ( ! empty( $e['featured'] ) ? 'Featured' : 'Don’t miss' ) . '</span>';
		$body  = '' !== $meta ? '<div class="meta">' . $meta . '</div>' : '';
	} else {
		$chips = fortw_nl_tag_chip( $e ) . ( $e['is_new'] ? '<span class="new">New</span>' : '' );
		$img   = fortw_image_of( $e );
		// The time, place and Q under the summary, one a line, then the link (as in This week).
		$body  = '<p class="sum sum--sm">' . fortw_h( fortw_summary_of( $e, 170 ) ) . '</p>
        ' . ( '' !== $meta ? '<div class="meta">' . $meta . '</div>' : '' ) . '
        ' . fortw_nl_also( $e['also'] ) . '
        <div class="links"><a class="lnk" href="' . $url . '">Details ↗</a>' . ( '' !== fortw_nl_cal_link( $e, $ctx ) ? '<span class="sp"> </span>' . fortw_nl_cal_link( $e, $ctx ) : '' ) . '</div>';
	}
	return '
    <table role="presentation" class="row" width="100%"><tr>
      <td class="row-date" valign="top" width="52"><div class="dow">' . fortw_nl_word( $p['mon'] ) . '</div><div class="dnum dnum--sm">' . $p['day'] . '</div></td>
      <td valign="top">' . fortw_nl_with_flyer(
			'<div class="row-head"><a class="title title--sm" href="' . $url . '">' . fortw_h( $e['title'] ) . '</a>' . $chips . '</div>
        ' . $body,
			empty( $img ) ? '' : '<a href="' . $url . '"><img class="thumb thumb--sm" src="' . fortw_h( $img ) . '" width="96" alt="' . fortw_h( $e['title'] ) . ' flyer"></a>',
			108
		) . '</td>
    </tr></table>';
}

function fortw_nl_featured( $e, $ctx ) {
	$img  = fortw_image_of( $e );
	$meta = fortw_nl_meta_html( $e );
	$when = '';
	if ( $e['next_occurrence'] ) {
		// The day, date and time large above the title (the flyer may not say them).
		$next = $e['next_occurrence'];
		$p    = fortw_date_parts( ! empty( $e['running'] ) ? $next['end_date'] : $next['date'] );
		$day  = fortw_nl_word( $p['long_dow'] ) . ', ' . fortw_nl_word( $p['mon'] ) . ' ' . $p['day'];
		// Running already: how long it's on for. Otherwise its first day, and its last if it has one.
		$when = ! empty( $e['running'] ) ? 'Through ' . $day : fortw_nl_meta( array( $day, fortw_nl_when( $next ) ) );
	}
	$url  = fortw_h( $ctx['entry_url']( $e ) );
	// The flyer beside the write-up: two real cells, which the phone layout stacks (the old
	// newsletter's way: Gmail Android lets @media override a <td>'s own layout, not inline CSS).
	$body = '
    <td class="featured-body" valign="top">
      <div class="when"><span class="badge">Featured</span>' . ( '' === $when ? '<span class="fmeta">Ongoing</span>' : '' ) . '</div>
      ' . ( '' !== $when ? '<div class="fdate">' . fortw_h( $when ) . '</div>' : '' ) . '
      <a class="ftitle" href="' . $url . '">' . fortw_h( $e['title'] ) . '</a>
      ' . ( '' !== $meta ? '<div class="fmeta">' . $meta . '</div>' : '' ) . '
      ' . fortw_nl_also( $e['also'] ) . '
      ' . implode( '', array_map( function ( $p ) { return '<p class="sum">' . fortw_h( $p ) . '</p>'; }, fortw_writeup_of( $e ) ) ) . '
      <div class="links"><a class="btn" href="' . $url . '">Details ↗</a>' . ( '' !== fortw_nl_cal_link( $e, $ctx ) ? '<span class="sp"> </span>' . fortw_nl_cal_link( $e, $ctx ) : '' ) . ( fortw_is_http_url( $e['link'] ?? '' ) ? '<span class="sp"> </span><a class="lnk" href="' . fortw_h( $e['link'] ) . '">Link ↗</a>' : '' ) . '</div>
    </td>';
	$media = $img ? '
    <td class="feat-media" valign="top" width="256"><a href="' . $url . '"><img class="hero" src="' . fortw_h( $img ) . '" width="240" alt="' . fortw_h( $e['title'] ) . '"></a></td>' : '';
	return '
  <div class="featured"><table role="presentation" class="feat-split" width="100%"><tr>' . $media . $body . '
  </tr></table></div>';
}

/** A section with its heading. $accent: true for the accent rule, or a name for that variant ('dm'). */
function fortw_nl_section( $title, $aside, $body, $accent = false ) {
	$head = true === $accent ? ' sec-head--accent' : ( $accent ? ' sec-head--' . $accent : '' );
	return '
  <div class="section">
    <table role="presentation" class="sec-head' . $head . '" width="100%"><tr>
      <td class="sec-title">' . fortw_h( $title ) . '</td>
      <td class="sec-aside" align="right">' . fortw_h( $aside ) . '</td>
    </tr></table>
    ' . $body . '
  </div>';
}

/**
 * The region's week under the masthead, as a small labelled table: the FNG challenge (count, a
 * progress bar and the day of the year), shovel flags, VQs and this week's FNGs. A table rather
 * than chips: long names wrap inside their row instead of piling up.
 */
function fortw_nl_ledger( $region ) {
	$rows = array();
	if ( ! empty( $region['fng_stats'] ) ) {
		$f    = $region['fng_stats'];
		$goal = max( 1, (int) $f['goal'] );
		$pct  = max( 0, min( 100, (int) round( 100 * (int) $f['total'] / $goal ) ) );
		// The bar is two table cells (email has no other way to draw one); a 0% or 100% bar is one.
		$bar    = ( $pct > 0 ? '<td class="bar-fill" width="' . $pct . '%" height="6">&nbsp;</td>' : '' )
			. ( $pct < 100 ? '<td class="bar-rest" height="6">&nbsp;</td>' : '' );
		$rows[] = array(
			'FNG challenge',
			'<b class="amber">' . (int) $f['total'] . '</b> of ' . $goal . ' · day ' . (int) $f['days_elapsed'] . ' of 365'
			. '<table role="presentation" class="bar" width="100%"><tr>' . $bar . '</tr></table>',
		);
	}
	foreach ( $region['shovel_flags'] ?? array() as $s ) {
		$rows[] = array( 'Shovel flag', fortw_h( $s['from'] ) . ' → ' . fortw_h( $s['to'] ) . ( $s['ao'] ? ' <span class="dim">@ ' . fortw_h( $s['ao'] ) . '</span>' : '' ) );
	}
	$vqs = array_map( function ( $v ) { return fortw_h( $v['name'] ) . ( $v['ao'] ? ' <span class="dim">@ ' . fortw_h( $v['ao'] ) . '</span>' : '' ); }, $region['vqs'] ?? array() );
	if ( $vqs ) {
		$rows[] = array( 1 === count( $vqs ) ? 'VQ' : 'VQs', implode( '<br>', $vqs ) );
	}
	// One a line, with who EH'd him (as the VQs show their AO).
	$fngs = array();
	foreach ( $region['weekly_fngs'] ?? array() as $f ) {
		$f = is_array( $f ) ? $f : array( 'name' => (string) $f, 'eh' => '' );
		if ( '' !== (string) $f['name'] ) {
			$fngs[] = fortw_h( $f['name'] ) . ( '' !== (string) ( $f['eh'] ?? '' ) ? ' <span class="dim">EH’d by ' . fortw_h( $f['eh'] ) . '</span>' : '' );
		}
	}
	if ( $fngs ) {
		$rows[] = array( 1 === count( $fngs ) ? 'FNG this week' : 'FNGs this week', implode( '<br>', $fngs ) );
	}
	return fortw_nl_ledger_table( $rows );
}

/** Rows of array( label, value HTML ) as the ledger's labelled table ('' for none). */
function fortw_nl_ledger_table( $rows, $class = 'ledger' ) {
	if ( ! $rows ) {
		return '';
	}
	$last = count( $rows ) - 1;
	return '<table role="presentation" class="' . $class . '" width="100%">' . implode(
		'',
		array_map(
			function ( $r, $i ) use ( $last ) {
				$cls = $i === $last ? ' lg-last' : '';
				return '<tr><td class="lg-label' . $cls . '" width="128" valign="top">' . $r[0] . '</td><td class="lg-value' . $cls . '" valign="top">' . $r[1] . '</td></tr>';
			},
			$rows,
			array_keys( $rows )
		)
	) . '</table>';
}

function fortw_nl_nantan( $n ) {
	if ( ! $n || '' === fortw_text_of( $n['text_html'] ) ) {
		return '';
	}
	return '
  <div class="quote">
    <div class="qmark">“</div>
    <div class="qtext">' . $n['text_html'] . '</div>
    <div class="qby">— ' . fortw_h( ( $n['author'] ? $n['author'] . ', ' : '' ) . "the Nan'tan" ) . '</div>
  </div>';
}

/**
 * Every week: the Fs' standing events, one a line (name, then time · day · place), each F in its
 * own column (side by side, stacked on a phone) ending with its calendar link. An F with links but
 * no events (the 1st F's workout list) adds them to the region's link pills instead.
 */
function fortw_nl_every_week( $region ) {
	$names = array( 'fitness' => '1st F · Fitness', 'fellowship' => '2nd F · Fellowship', 'faith' => '3rd F · Faith' );
	$cols  = array();
	$extra = array();
	foreach ( $region['three_fs'] ?? array() as $col ) {
		$events = array();
		$links  = array();
		foreach ( $col['items'] as $i ) {
			if ( 'link' === $i['type'] ) {
				if ( fortw_is_http_url( $i['url'] ?? '' ) && '' !== (string) $i['label'] ) {
					$links[] = array( 'label' => $i['label'], 'url' => $i['url'] );
				}
			} elseif ( '' !== (string) $i['name'] ) {
				$events[] = '<div class="ew-item"><span class="title title--sm">' . fortw_h( $i['name'] ) . '</span>' . ( $i['detail'] ? '<div class="meta">' . fortw_h( $i['detail'] ) . '</div>' : '' ) . '</div>';
			}
		}
		if ( ! $events ) {
			$extra = array_merge( $extra, $links );
			continue;
		}
		$more   = implode( '<span class="sp"> </span>', array_map( function ( $l ) { return '<a class="lnk" href="' . fortw_h( $l['url'] ) . '">' . fortw_h( $l['label'] ) . ' ↗</a>'; }, $links ) );
		$cols[] = '<div class="label ew-head">' . fortw_h( $names[ $col['column'] ] ?? ucfirst( (string) $col['column'] ) ) . '</div>' . implode( '', $events ) . ( '' !== $more ? '<p class="small">' . $more . '</p>' : '' );
	}
	$width = $cols ? (int) floor( 100 / count( $cols ) ) : 100;
	$table = $cols ? '<table role="presentation" class="ew" width="100%"><tr>' . implode( '', array_map( function ( $c ) use ( $width ) { return '<td class="ew-col" valign="top" width="' . $width . '%">' . $c . '</td>'; }, $cols ) ) . '</tr></table>' : '';
	$pills = implode( ' ', array_map( function ( $l ) { return '<a class="pill" href="' . fortw_h( $l['url'] ) . '">' . fortw_h( $l['label'] ) . ' ↗</a>'; }, array_merge( $extra, $region['links'] ?? array() ) ) );
	return '
  <div class="every">
    ' . ( '' !== $table ? '<div class="label">Every week</div>' . $table : '' ) . '
    ' . ( '' !== $pills ? '<div class="pills">' . $pills . '</div>' : '' ) . '
  </div>';
}

function fortw_nl_footer( $region, $ctx ) {
	// Your SLT: role and name, one a row, as the ledger at the top shows the week.
	$slt = fortw_nl_ledger_table(
		array_map( function ( $s ) { return array( fortw_h( $s['role'] ), fortw_h( $s['name'] ) ); }, array_values( array_filter( $region['slt'] ?? array(), function ( $s ) { return '' !== (string) $s['name']; } ) ) ),
		'ledger slt'
	);
	return '
  <div class="footer">
    ' . ( '' !== $slt ? '<div class="label">Your SLT</div>' . $slt : '' ) . '
    <p class="small"><a class="lnk" href="' . fortw_h( $ctx['submit_url'] ) . '">Submit an entry ↗</a><span class="sp"> </span><a class="lnk" href="' . fortw_h( $ctx['site_url'] ) . '">f3thefort.com ↗</a></p>
    <p class="small dim">© ' . fortw_h( $ctx['year'] ) . ' <span class="copy">The Fort F3</span> · <a class="dim" href="mailto:thefort@f3nation.com">thefort@f3nation.com</a></p>
  </div>';
}

/**
 * The whole issue in $template (which carries the CSS and {{TITLE}} / {{BODY}}).
 * $ctx: site_url, submit_url, year, and entry_url (callable: entry → its page on the site).
 */
function fortw_render_agenda( $template, $entries, $region, $today, $ctx ) {
	$sel = fortw_select_issue( $entries, $today );
	$rp  = array_map( 'fortw_nl_word', fortw_date_parts( $sel['range']['from'] ) );
	$rq  = array_map( 'fortw_nl_word', fortw_date_parts( $sel['range']['to'] ) );
	$rng = $rp['mon'] === $rq['mon'] ? $rp['mon'] . ' ' . $rp['day'] . ' – ' . $rq['day'] : $rp['mon'] . ' ' . $rp['day'] . ' – ' . $rq['mon'] . ' ' . $rq['day'];
	$n   = count( $sel['coming_up'] );

	$parts = array(
		'<table role="presentation" class="mast" width="100%"><tr>
      <td class="brand">The Fort <span class="amber">Weekly</span></td>
      <td class="issue" align="right">Week of ' . $rp['mon'] . ' ' . $rp['day'] . '</td>
    </tr></table>',
		fortw_nl_ledger( $region ),
		fortw_nl_nantan( $region['nantan'] ?? null ),
		$sel['featured'] ? fortw_nl_featured( $sel['featured'], $ctx ) : '',
		$sel['dont_miss'] ? fortw_nl_section( 'Don’t miss', 'Plan ahead', implode( '', array_map( function ( $e ) use ( $ctx ) { return fortw_nl_dont_miss_entry( $e, $ctx ); }, $sel['dont_miss'] ) ), 'dm' ) : '',
		$sel['this_week'] ? fortw_nl_section( 'This week', $rng, implode( '', array_map( function ( $d ) use ( $ctx ) { return fortw_nl_day( $d, $ctx ); }, $sel['this_week'] ) ), true ) : '',
		$sel['happening_now'] ? fortw_nl_section( 'Happening now', count( $sel['happening_now'] ) . ' on now', implode( '', array_map( function ( $e ) use ( $ctx ) { return fortw_nl_coming( $e, $ctx ); }, $sel['happening_now'] ) ) ) : '',
		$n ? fortw_nl_section( 'Coming up', $n . ' ' . ( 1 === $n ? 'event' : 'events' ), implode( '', array_map( function ( $e ) use ( $ctx ) { return fortw_nl_coming( $e, $ctx ); }, $sel['coming_up'] ) ) ) : '',
		$sel['ongoing'] ? fortw_nl_section(
			'Ongoing',
			'',
			implode(
				'',
				array_map(
					function ( $e ) use ( $ctx ) {
						$url = fortw_h( $ctx['entry_url']( $e ) );
						if ( ! empty( $e['featured'] ) || ! empty( $e['called_out'] ) ) {
							return '
      <div class="ongoing"><a class="title title--sm" href="' . $url . '">' . fortw_h( $e['title'] ) . '</a><span class="new">' . ( ! empty( $e['featured'] ) ? 'Featured' : 'Don’t miss' ) . '</span></div>';
						}
						return '
      <div class="ongoing"><a class="title title--sm" href="' . $url . '">' . fortw_h( $e['title'] ) . '</a>
        <p class="sum sum--sm">' . fortw_h( fortw_summary_of( $e, 200 ) ) . ' <a class="lnk" href="' . $url . '">Details ↗</a></p></div>';
					},
					$sel['ongoing']
				)
			)
		) : '',
		fortw_nl_every_week( $region ),
		fortw_nl_footer( $region, $ctx ),
	);
	$body  = implode( "\n", array_filter( $parts, 'strlen' ) );
	$title = 'The Fort Weekly — week of ' . $rp['mon'] . ' ' . $rp['day'];
	return str_replace( array( '{{TITLE}}', '{{BODY}}' ), array( fortw_h( $title ), $body ), $template );
}

/** The issue's Sunday: today if it is Sunday, else the coming one (as the app's getNextSundayInfo()). */
function fortw_next_sunday( $today ) {
	$dow = (int) gmdate( 'w', strtotime( $today . ' 00:00:00 UTC' ) ); // 0 = Sunday.
	return fortw_add_days( $today, 0 === $dow ? 0 : 7 - $dow );
}

/** The campaign's name in Mailchimp, e.g. "October 25, 2026" (as the app named them). */
function fortw_campaign_title( $sunday ) {
	return gmdate( 'F j, Y', strtotime( $sunday . ' 00:00:00 UTC' ) );
}

/** The subject line, e.g. "F3 The Fort Weekly Newsletter - 10/25/2026". */
function fortw_campaign_subject( $sunday ) {
	return 'F3 The Fort Weekly Newsletter - ' . gmdate( 'm/d/Y', strtotime( $sunday . ' 00:00:00 UTC' ) );
}
