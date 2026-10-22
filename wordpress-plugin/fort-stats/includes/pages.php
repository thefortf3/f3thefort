<?php
/**
 * The stats pages.
 *
 * - /stats/ — the dashboard (public/dashboard.html, from the stats repo's web/static/index.html),
 *   inside the site's theme: the theme's header, footer, fonts and colours. A theme can lay the
 *   page out with its own `fort-stats.php` template (calling fort_stats_dashboard()); otherwise
 *   templates/dashboard.php is used.
 * - /stats/fng-challenge/ — the FNG challenge board, a standalone page (public/fng.html).
 *
 * The dashboard's styling is Tailwind's (as on stats.f3thefort.com), limited to #fort-stats and
 * mapped onto the theme's CSS variables, with its global reset off so the theme is untouched.
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

/** True on /stats/ (the dashboard). */
function fort_stats_is_dashboard() {
	return 'index' === get_query_var( 'fstats_page' );
}

add_action(
	'template_redirect',
	function () {
		$page = get_query_var( 'fstats_page' );
		if ( 'fng' === $page ) {
			header( 'Content-Type: text/html; charset=utf-8' );
			header( 'X-Robots-Tag: noindex' );
			echo fstats_fng_page_html(); // phpcs:ignore WordPress.Security.EscapeOutput -- our own static page.
			exit;
		}
		if ( 'index' === $page ) {
			// Not a 404: WordPress found no post for this address, but the page is ours.
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

add_filter(
	'document_title_parts',
	function ( $parts ) {
		if ( fort_stats_is_dashboard() ) {
			// WordPress treats the address as the blog index, whose title is the site name and tagline.
			$parts = array( 'title' => __( 'Stats', 'fort-stats' ), 'site' => get_bloginfo( 'name', 'display' ) );
		}
		return $parts;
	}
);

add_filter(
	'body_class',
	function ( $classes ) {
		if ( fort_stats_is_dashboard() ) {
			$classes[] = 'fort-stats-page';
		}
		return $classes;
	}
);

add_action(
	'wp_head',
	function () {
		if ( fort_stats_is_dashboard() ) {
			echo '<meta name="robots" content="noindex">' . "\n";
		}
	},
	1
);

add_action(
	'wp_enqueue_scripts',
	function () {
		if ( ! fort_stats_is_dashboard() ) {
			return;
		}
		$base = plugins_url( 'public/', FORT_STATS_FILE );
		$ver  = FORT_STATS_VERSION . '-' . filemtime( FORT_STATS_DIR . '/public/app.js' );
		// Tailwind's browser build, as stats.f3thefort.com uses; its config follows it.
		wp_enqueue_script( 'fstats-tailwind', 'https://cdn.tailwindcss.com', array(), null, false ); // phpcs:ignore WordPress.WP.EnqueuedResourceParameters.MissingVersion
		wp_add_inline_script( 'fstats-tailwind', fstats_tailwind_config() );
		wp_enqueue_script( 'fstats-chart', 'https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js', array(), '4.4.3', false );
		wp_enqueue_script( 'fstats-alpine', 'https://cdn.jsdelivr.net/npm/alpinejs@3.14.1/dist/cdn.min.js', array(), '3.14.1', array( 'strategy' => 'defer', 'in_footer' => false ) );
		wp_enqueue_script( 'fstats-app', $base . 'app.js', array( 'fstats-chart' ), $ver, true );
		wp_add_inline_script( 'fstats-app', 'window.FORT_STATS_API_BASE = ' . wp_json_encode( esc_url_raw( rest_url( FSTATS_NS ) ) ) . ';', 'before' );
		wp_enqueue_style( 'fstats-app', $base . 'app.css', array(), $ver );
	},
	20
);

/**
 * Tailwind's config: utilities only inside #fort-stats, no global reset, and the dashboard's
 * colour and font names mapped onto the theme's CSS variables (opacity modifiers like
 * bg-gold/20 still work, through color-mix).
 */
function fstats_tailwind_config() {
	$c      = fn( $var ) => "color-mix(in srgb, var($var) calc(<alpha-value> * 100%), transparent)";
	$config = array(
		'important'   => '#fort-stats',
		'corePlugins' => array( 'preflight' => false ),
		'theme'       => array(
			'extend' => array(
				'fontFamily' => array( 'display' => array( 'var(--display)' ), 'body' => array( 'var(--body)' ), 'mono' => array( 'var(--mono)' ) ),
				'colors'     => array(
					'surface' => $c( '--panel-2' ),
					'card'    => $c( '--panel' ),
					'border'  => $c( '--line-2' ),
					'gold'    => $c( '--amber' ),
					'f3blue'  => $c( '--accent2' ),
					'muted'   => $c( '--text-mute' ),
					'silver'  => '#a9b0bb',
					'bronze'  => '#b98450',
					'white'   => $c( '--bg' ), // Only used for text on accent-coloured buttons: dark on the theme's light accents.
					'slate'   => array(
						'200' => $c( '--text-bright' ),
						'300' => $c( '--text' ),
						'400' => $c( '--text-dim' ),
						'500' => $c( '--text-mute' ),
					),
				),
			),
		),
	);
	return 'tailwind.config = ' . wp_json_encode( $config, JSON_UNESCAPED_SLASHES ) . ';';
}

/** The dashboard's markup (call inside a page; its scripts and styles are already enqueued). */
function fort_stats_dashboard() {
	echo file_get_contents( FORT_STATS_DIR . '/public/dashboard.html' ); // phpcs:ignore WordPress.Security.EscapeOutput, WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- our own static markup.
}

/** The FNG challenge page's HTML, its data from WordPress. */
function fstats_fng_page_html() {
	$html = (string) file_get_contents( FORT_STATS_DIR . '/public/fng.html' ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
	$head = '<meta name="robots" content="noindex">'
		. '<script>window.FORT_STATS_API_BASE = ' . wp_json_encode( esc_url_raw( rest_url( FSTATS_NS ) ) ) . ';</script>';
	return preg_replace( '/<head>/i', '<head>' . $head, $html, 1 );
}
