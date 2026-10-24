<?php
/**
 * "Add to calendar": /events/<slug>/?calendar=ics serves the event's upcoming dates as an .ics
 * file (iPhone, Mac, Outlook open it as "add event"), and fortw_calendar_links() gives the theme
 * and the newsletter that address and a Google Calendar link (Android). Built by
 * includes/pure/calendar.php. Only published events; a past event offers its last date.
 *
 * @package FortWeekly
 */

defined( 'ABSPATH' ) || exit;

/** The dates to offer: the upcoming ones, else the last one; array() for an ongoing event. */
function fortw_calendar_dates( $e ) {
	$occ = (array) ( $e['occurrences'] ?? array() );
	if ( ! $occ ) {
		return array();
	}
	$up = fortw_upcoming_dates( $occ, fortw_today() );
	return $up ? $up : array( end( $occ ) );
}

/** An entry (or the public shape the theme gets) as fortw_ics() / fortw_google_calendar_url() take it. */
function fortw_calendar_event( $e ) {
	$url = home_url( '/events/' . rawurlencode( $e['slug'] ) . '/' );
	return array(
		'id'       => $e['id'],
		'title'    => $e['title'],
		'location' => $e['location'] ?? '',
		'summary'  => fortw_summary_of( array( 'summary' => $e['summary'] ?? '', 'description' => $e['description'] ?? ( $e['description_html'] ?? '' ) ), 300 ),
		'url'      => $url,
	);
}

/**
 * The event's "Add to calendar" links: array( ics => …, google => … (its next date), dates =>
 * how many dates the .ics holds ), or null for an event with no dates.
 */
function fortw_calendar_links( $e ) {
	$dates = fortw_calendar_dates( $e );
	if ( ! $dates ) {
		return null;
	}
	$ev = fortw_calendar_event( $e );
	return array(
		'ics'    => add_query_arg( 'calendar', 'ics', $ev['url'] ),
		'google' => fortw_google_calendar_url( $ev, $dates[0] ),
		'dates'  => count( $dates ),
	);
}

add_action(
	'template_redirect',
	function () {
		if ( ! isset( $_GET['calendar'] ) || ! is_singular( FORTW_POST_TYPE ) ) { // phpcs:ignore WordPress.Security.NonceVerification -- a read-only download
			return;
		}
		$e     = fortw_entry( get_queried_object() );
		$dates = fortw_is_public( $e ) ? fortw_calendar_dates( $e ) : array();
		if ( ! $dates ) {
			status_header( 404 );
			nocache_headers();
			exit;
		}
		header( 'Content-Type: text/calendar; charset=utf-8' );
		header( 'Content-Disposition: inline; filename="' . sanitize_file_name( $e['slug'] ) . '.ics"' );
		header( 'X-Robots-Tag: noindex' );
		echo fortw_ics( fortw_calendar_event( $e ), $dates, time(), (string) wp_parse_url( home_url(), PHP_URL_HOST ) ); // phpcs:ignore WordPress.Security.EscapeOutput -- iCalendar, escaped by fortw_ics_text()
		exit;
	},
	5
);
