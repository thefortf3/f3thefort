<?php
/**
 * The stats pages' addresses. The theme lays them out (its fort-stats.php, using the data
 * functions in api.php and the helpers in pure/views.php); a theme without one gets
 * templates/dashboard.php.
 *
 *   /stats/                  leaderboard        /stats/pax/<id>/   one PAX
 *   /stats/aos/              AOs                /stats/aos/<id>/   one AO
 *   /stats/trends/           trends
 *   /stats/streaks/          streaks
 *   /stats/fngs/             FNGs
 *
 * Filters (range, month, sort, search, page) are ordinary query arguments.
 *
 * @package FortStats
 */

defined( 'ABSPATH' ) || exit;

/** The views with their own address, and their page titles. */
const FSTATS_VIEWS = array(
	'leaderboard' => 'Stats',
	'aos'         => 'AO stats',
	'trends'      => 'Trends',
	'streaks'     => 'Streaks',
	'fngs'        => 'FNGs',
);

function fstats_register_pages() {
	add_rewrite_rule( '^stats/?$', 'index.php?fstats_view=leaderboard', 'top' );
	add_rewrite_rule( '^stats/pax/(\d+)/?$', 'index.php?fstats_view=pax&fstats_id=$matches[1]', 'top' );
	add_rewrite_rule( '^stats/aos/(\d+)/?$', 'index.php?fstats_view=ao&fstats_id=$matches[1]', 'top' );
	add_rewrite_rule( '^stats/(aos|trends|streaks|fngs)/?$', 'index.php?fstats_view=$matches[1]', 'top' );
	// The FNG challenge board is gone; old links (and stats.f3thefort.com/fng-challenge) land on FNGs.
	add_rewrite_rule( '^stats/fng-challenge/?$', 'index.php?fstats_view=fng-challenge', 'top' );
}

add_action(
	'init',
	function () {
		fstats_register_pages();
		// Put the addresses back if a flush happened without them, or they have changed since (e.g. the
		// plugin was updated in place).
		$rules = get_option( 'rewrite_rules' );
		if ( is_array( $rules ) && ! isset( $rules['^stats/(aos|trends|streaks|fngs)/?$'] ) ) {
			flush_rewrite_rules( false );
		}
	}
);

add_filter(
	'query_vars',
	function ( $vars ) {
		$vars[] = 'fstats_view';
		$vars[] = 'fstats_id';
		return $vars;
	}
);

/** The stats view being shown ('leaderboard', 'aos', 'ao', 'pax', …), or '' on other pages. */
function fort_stats_view() {
	$v = (string) get_query_var( 'fstats_view' );
	return isset( FSTATS_VIEWS[ $v ] ) || in_array( $v, array( 'ao', 'pax' ), true ) ? $v : '';
}

/** The PAX or AO id on /stats/pax/<id>/ and /stats/aos/<id>/. */
function fort_stats_id() {
	return (int) get_query_var( 'fstats_id' );
}

/** True on any stats page. */
function fort_stats_is_dashboard() {
	return '' !== fort_stats_view();
}

/**
 * A stats page's address. $view: one of FSTATS_VIEWS, 'pax' or 'ao' (with $id); $args: query
 * arguments (empty ones are left out).
 */
function fort_stats_url( $view = 'leaderboard', $id = null, array $args = array() ) {
	$path = array(
		'leaderboard' => 'stats/',
		'pax'         => 'stats/pax/' . (int) $id . '/',
		'ao'          => 'stats/aos/' . (int) $id . '/',
	)[ $view ] ?? 'stats/' . $view . '/';
	return add_query_arg( array_filter( $args, fn( $v ) => null !== $v && '' !== $v ), home_url( '/' . $path ) );
}

add_action(
	'template_redirect',
	function () {
		if ( 'fng-challenge' === get_query_var( 'fstats_view' ) ) {
			wp_safe_redirect( fort_stats_url( 'fngs' ), 301 );
			exit;
		}
		if ( fort_stats_is_dashboard() ) {
			// WordPress found no post for this address, but the page is ours.
			global $wp_query;
			$wp_query->is_404 = false;
			status_header( 200 );
		}
	}
);

add_filter(
	'template_include',
	function ( $template ) {
		if ( ! fort_stats_is_dashboard() ) {
			return $template;
		}
		return locate_template( 'fort-stats.php' ) ?: FORT_STATS_DIR . '/templates/dashboard.php';
	},
	99
);

/** The page title: the view's, or the PAX's / AO's name. */
function fort_stats_title() {
	$view = fort_stats_view();
	if ( 'pax' === $view || 'ao' === $view ) {
		$core = fort_stats_core();
		if ( $core ) {
			$d = 'pax' === $view ? fstats_pax_detail( $core, fort_stats_id() ) : fstats_ao_detail( $core, fort_stats_id(), $core['today'] );
			if ( $d ) {
				return 'pax' === $view ? $d['f3_name'] : $d['ao_name'];
			}
		}
		return __( 'Stats', 'fort-stats' );
	}
	return __( FSTATS_VIEWS[ $view ] ?? 'Stats', 'fort-stats' ); // phpcs:ignore WordPress.WP.I18n.NonSingularStringLiteralText
}

add_filter(
	'document_title_parts',
	function ( $parts ) {
		if ( fort_stats_is_dashboard() ) {
			// WordPress treats these addresses as the blog index, whose title is the site name and tagline.
			$parts = array( 'title' => fort_stats_title(), 'site' => get_bloginfo( 'name', 'display' ) );
		}
		return $parts;
	}
);

add_filter(
	'body_class',
	function ( $classes ) {
		if ( fort_stats_is_dashboard() ) {
			$classes[] = 'fort-stats-page';
			$classes[] = 'fort-stats-' . fort_stats_view();
		}
		return $classes;
	}
);

add_action(
	'wp_head',
	function () {
		// Filtered and searched variants of the same page aren't worth indexing.
		if ( fort_stats_is_dashboard() && ! empty( $_GET ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended
			echo '<meta name="robots" content="noindex, follow">' . "\n";
		}
	},
	1
);
