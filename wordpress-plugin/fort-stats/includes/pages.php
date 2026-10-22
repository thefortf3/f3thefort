<?php
/**
 * The stats pages: /stats/ (the dashboard) and /stats/fng-challenge/, the same pages
 * stats.f3thefort.com serves (public/, copied from the stats repo's web/static/). Their only
 * changes: assets load from the plugin and the data comes from /wp-json/fort-stats/v1.
 *
 * @package FortStats
 */

defined( 'ABSPATH' ) || exit;

function fstats_register_pages() {
	add_rewrite_rule( '^stats/?$', 'index.php?fstats_page=index', 'top' );
	add_rewrite_rule( '^stats/fng-challenge/?$', 'index.php?fstats_page=fng', 'top' );
}

add_action(
	'init',
	function () {
		fstats_register_pages();
		// Put the addresses back if a flush happened without them (e.g. the plugin was updated in place).
		$rules = get_option( 'rewrite_rules' );
		if ( is_array( $rules ) && ! isset( $rules['^stats/?$'] ) ) {
			flush_rewrite_rules( false );
		}
	}
);

add_filter(
	'query_vars',
	function ( $vars ) {
		$vars[] = 'fstats_page';
		return $vars;
	}
);

add_action(
	'template_redirect',
	function () {
		$page = get_query_var( 'fstats_page' );
		if ( ! in_array( $page, array( 'index', 'fng' ), true ) ) {
			return;
		}
		header( 'Content-Type: text/html; charset=utf-8' );
		header( 'X-Robots-Tag: noindex' );
		echo fstats_page_html( $page ); // phpcs:ignore WordPress.Security.EscapeOutput -- our own static page.
		exit;
	}
);

/** The page's HTML with its asset links and API base pointed at WordPress. */
function fstats_page_html( $page ) {
	$html = (string) file_get_contents( FORT_STATS_DIR . '/public/' . ( 'fng' === $page ? 'fng.html' : 'index.html' ) ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
	$base = plugins_url( 'public/', FORT_STATS_FILE );
	$ver  = rawurlencode( FORT_STATS_VERSION . '-' . filemtime( FORT_STATS_DIR . '/public/app.js' ) );
	$html = str_replace(
		array( 'href="/app.css"', 'src="/app.js"' ),
		array( 'href="' . esc_url( $base . 'app.css?ver=' . $ver ) . '"', 'src="' . esc_url( $base . 'app.js?ver=' . $ver ) . '"' ),
		$html
	);
	$head = '<meta name="robots" content="noindex">'
		. '<script>window.FORT_STATS_API_BASE = ' . wp_json_encode( esc_url_raw( rest_url( FSTATS_NS ) ) ) . ';</script>';
	return preg_replace( '/<head>/i', '<head>' . $head, $html, 1 );
}
