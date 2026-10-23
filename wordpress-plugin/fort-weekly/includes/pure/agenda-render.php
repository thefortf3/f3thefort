<?php
/**
 * The Fort Weekly "agenda" issue (design canvas E3): masthead and stat chips, the Nan'tan's note,
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
	if ( mb_strlen( $s ) <= $max ) {
		return $s;
	}
	$cut   = mb_substr( $s, 0, $max );
	$space = mb_strrpos( $cut, ' ' );
	$cut   = mb_substr( $cut, 0, max( false === $space ? -1 : $space, $max - 20 ) );
	return preg_replace( '/[\s,.;:—-]+$/u', '', $cut ) . '…';
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

function fortw_nl_links( $e, $ctx ) {
	$out = array( '<a class="lnk" href="' . fortw_h( $ctx['entry_url']( $e ) ) . '">Details ↗</a>' );
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

function fortw_nl_week_entry( $e, $ctx ) {
	$img  = fortw_image_of( $e );
	$meta = fortw_nl_meta( array( (string) $e['location'], $e['leader'] ? 'Q: ' . $e['leader'] : '' ) );
	$url  = fortw_h( $ctx['entry_url']( $e ) );
	$body = '
        <div class="when">' . fortw_h( fortw_nl_time( $e['next_occurrence'] ) ) . fortw_nl_tag_chip( $e ) . ( $e['is_new'] ? '<span class="new">New</span>' : '' ) . '</div>
        <a class="title" href="' . $url . '">' . fortw_h( $e['title'] ) . '</a>
        ' . ( '' !== $meta ? '<div class="meta">' . fortw_h( $meta ) . '</div>' : '' ) . '
        <p class="sum">' . fortw_h( fortw_summary_of( $e ) ) . '</p>
        ' . fortw_nl_also( $e['also'] ) . '
        ' . fortw_nl_links( $e, $ctx );
	if ( ! $img ) {
		return '<div class="item">' . $body . '</div>';
	}
	return '<div class="item"><table role="presentation" class="split" width="100%"><tr>
        <td class="split-main" valign="top">' . $body . '</td>
        <td class="split-thumb" valign="top" width="72"><a href="' . $url . '"><img class="thumb" src="' . fortw_h( $img ) . '" width="64" alt="' . fortw_h( $e['title'] ) . ' flyer"></a></td>
      </tr></table></div>';
}

function fortw_nl_day( $day, $ctx ) {
	$p = fortw_date_parts( $day['date'] );
	return '
    <table role="presentation" class="day" width="100%"><tr>
      <td class="day-label" valign="top" width="52"><div class="dow">' . fortw_nl_word( $p['dow'] ) . '</div><div class="dnum">' . $p['day'] . '</div></td>
      <td class="day-items" valign="top">' . implode( '', array_map( function ( $e ) use ( $ctx ) { return fortw_nl_week_entry( $e, $ctx ); }, $day['entries'] ) ) . '</td>
    </tr></table>';
}

function fortw_nl_coming( $e, $ctx ) {
	$p    = fortw_date_parts( $e['next_occurrence']['date'] );
	$meta = fortw_nl_meta( array( fortw_nl_time( $e['next_occurrence'] ), (string) $e['location'], $e['leader'] ? 'Q: ' . $e['leader'] : '' ) );
	$url  = fortw_h( $ctx['entry_url']( $e ) );
	return '
    <table role="presentation" class="row" width="100%"><tr>
      <td class="row-date" valign="top" width="52"><div class="dow">' . fortw_nl_word( $p['mon'] ) . '</div><div class="dnum dnum--sm">' . $p['day'] . '</div></td>
      <td valign="top">
        <div class="row-head"><a class="title title--sm" href="' . $url . '">' . fortw_h( $e['title'] ) . '</a>' . fortw_nl_tag_chip( $e ) . ( $e['is_new'] ? '<span class="new">New</span>' : '' ) . '</div>
        <p class="sum sum--sm">' . fortw_h( fortw_summary_of( $e, 170 ) ) . ( '' !== $meta ? ' <span class="meta-inline">' . fortw_h( $meta ) . '</span>' : '' ) . ' <a class="lnk" href="' . $url . '">Details ↗</a></p>
        ' . fortw_nl_also( $e['also'] ) . '
      </td>
    </tr></table>';
}

function fortw_nl_featured( $e, $ctx ) {
	$img  = fortw_image_of( $e );
	$qs   = $e['leader'] ? ' · Q: ' . $e['leader'] : '';
	$when = 'Ongoing';
	if ( $e['next_occurrence'] ) {
		$p    = fortw_date_parts( $e['next_occurrence']['date'] );
		$when = fortw_nl_word( $p['dow'] ) . ' ' . fortw_nl_word( $p['mon'] ) . ' ' . $p['day'];
	}
	$url = fortw_h( $ctx['entry_url']( $e ) );
	return '
  <div class="featured">
    ' . ( $img ? '<a href="' . $url . '"><img class="hero" src="' . fortw_h( $img ) . '" width="568" alt="' . fortw_h( $e['title'] ) . '"></a>' : '' ) . '
    <div class="featured-body">
      <div class="when"><span class="badge">Featured</span><span class="fmeta">' . fortw_h( $when . $qs ) . '</span></div>
      <a class="ftitle" href="' . $url . '">' . fortw_h( $e['title'] ) . '</a>
      <p class="sum">' . fortw_h( fortw_summary_of( $e, 420 ) ) . '</p>
      <div class="links"><a class="btn" href="' . $url . '">Details ↗</a>' . ( fortw_is_http_url( $e['link'] ?? '' ) ? '<span class="sp"> </span><a class="lnk" href="' . fortw_h( $e['link'] ) . '">Link ↗</a>' : '' ) . '</div>
    </div>
  </div>';
}

function fortw_nl_section( $title, $aside, $body, $accent = false ) {
	return '
  <div class="section">
    <table role="presentation" class="sec-head' . ( $accent ? ' sec-head--accent' : '' ) . '" width="100%"><tr>
      <td class="sec-title">' . fortw_h( $title ) . '</td>
      <td class="sec-aside" align="right">' . fortw_h( $aside ) . '</td>
    </tr></table>
    ' . $body . '
  </div>';
}

function fortw_nl_chips( $region ) {
	$out = array();
	if ( ! empty( $region['fng_stats'] ) ) {
		$f     = $region['fng_stats'];
		$out[] = '<span class="chip"><b class="amber">' . (int) $f['total'] . '</b>/' . (int) $f['goal'] . ' FNGs</span>';
		$out[] = '<span class="chip">Day <b>' . (int) $f['days_elapsed'] . '</b>/365</span>';
	}
	foreach ( $region['shovel_flags'] ?? array() as $s ) {
		$out[] = '<span class="chip">Shovel flag: ' . fortw_h( $s['from'] ) . ' → ' . fortw_h( $s['to'] ) . ( $s['ao'] ? ' @ ' . fortw_h( $s['ao'] ) : '' ) . '</span>';
	}
	foreach ( $region['vqs'] ?? array() as $v ) {
		$out[] = '<span class="chip">VQ: ' . fortw_h( $v['name'] ) . ( $v['ao'] ? ' @ ' . fortw_h( $v['ao'] ) : '' ) . '</span>';
	}
	if ( ! empty( $region['weekly_fngs'] ) ) {
		$out[] = '<span class="chip">FNGs this week: ' . fortw_h( implode( ', ', array_filter( $region['weekly_fngs'], 'strlen' ) ) ) . '</span>';
	}
	return $out ? '<div class="chips">' . implode( ' ', $out ) . '</div>' : '';
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

function fortw_nl_every_week( $region ) {
	$items = array();
	foreach ( $region['three_fs'] ?? array() as $col ) {
		foreach ( $col['items'] as $i ) {
			if ( 'link' !== $i['type'] && '' !== (string) $i['name'] ) {
				$items[] = fortw_h( $i['name'] ) . ( $i['detail'] ? ' <span class="dim">' . fortw_h( $i['detail'] ) . '</span>' : '' );
			}
		}
	}
	$pills = implode( ' ', array_map( function ( $l ) { return '<a class="pill" href="' . fortw_h( $l['url'] ) . '">' . fortw_h( $l['label'] ) . ' ↗</a>'; }, $region['links'] ?? array() ) );
	$line  = implode( ' · ', $items );
	return '
  <div class="every">
    ' . ( '' !== $line ? '<div class="label">Every week</div><p class="sum sum--sm">' . $line . '</p>' : '' ) . '
    ' . ( '' !== $pills ? '<div class="pills">' . $pills . '</div>' : '' ) . '
  </div>';
}

function fortw_nl_footer( $region, $ctx ) {
	$slt = implode( ' · ', array_map( function ( $s ) { return fortw_h( $s['name'] ) . ' <span class="dim">(' . fortw_h( $s['role'] ) . ')</span>'; }, $region['slt'] ?? array() ) );
	return '
  <div class="footer">
    ' . ( '' !== $slt ? '<p class="sum sum--sm dim2">Your SLT: ' . $slt . '</p>' : '' ) . '
    <p class="small"><a class="lnk" href="' . fortw_h( $ctx['submit_url'] ) . '">Submit an entry ↗</a><span class="sp"> </span><a class="lnk" href="' . fortw_h( $ctx['site_url'] ) . '">f3thefort.com ↗</a></p>
    <p class="small dim">© ' . fortw_h( $ctx['year'] ) . ' <span class="copy">The Fort F3</span> · <a class="dim" href="mailto:thefort@f3nation.com">thefort@f3nation.com</a></p>
  </div>';
}

/**
 * The whole issue in $template (which carries the CSS and {{TITLE}} / {{BODY}}).
 * $ctx: site_url, submit_url, year, and entry_url (callable: entry → its page on the site).
 */
function fortw_render_agenda( $template, $entries, $region, $today, $ctx ) {
	$sel = fortw_select_agenda( $entries, $today );
	$rp  = array_map( 'fortw_nl_word', fortw_date_parts( $sel['range']['from'] ) );
	$rq  = array_map( 'fortw_nl_word', fortw_date_parts( $sel['range']['to'] ) );
	$rng = $rp['mon'] === $rq['mon'] ? $rp['mon'] . ' ' . $rp['day'] . ' – ' . $rq['day'] : $rp['mon'] . ' ' . $rp['day'] . ' – ' . $rq['mon'] . ' ' . $rq['day'];
	$n   = count( $sel['coming_up'] );

	$parts = array(
		'<table role="presentation" class="mast" width="100%"><tr>
      <td class="brand">The Fort <span class="amber">Weekly</span></td>
      <td class="issue" align="right">Week of ' . $rp['mon'] . ' ' . $rp['day'] . '</td>
    </tr></table>',
		fortw_nl_chips( $region ),
		fortw_nl_nantan( $region['nantan'] ?? null ),
		$sel['featured'] ? fortw_nl_featured( $sel['featured'], $ctx ) : '',
		$sel['this_week'] ? fortw_nl_section( 'This week', $rng, implode( '', array_map( function ( $d ) use ( $ctx ) { return fortw_nl_day( $d, $ctx ); }, $sel['this_week'] ) ), true ) : '',
		$n ? fortw_nl_section( 'Coming up', $n . ' ' . ( 1 === $n ? 'event' : 'events' ), implode( '', array_map( function ( $e ) use ( $ctx ) { return fortw_nl_coming( $e, $ctx ); }, $sel['coming_up'] ) ) ) : '',
		$sel['ongoing'] ? fortw_nl_section(
			'Ongoing',
			'',
			implode(
				'',
				array_map(
					function ( $e ) use ( $ctx ) {
						$url = fortw_h( $ctx['entry_url']( $e ) );
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
