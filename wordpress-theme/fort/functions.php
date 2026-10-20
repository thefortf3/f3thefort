<?php
/**
 * Fort theme: f3thefort.com, built from the same data as The Fort Weekly newsletter.
 *
 * Entries (events, initiatives, the Nan'tan's message, region info) come from the newsletter
 * app's public API; workouts/backblast stats come from the stats API; regular WordPress posts
 * (backblasts, pre-blasts) and pages keep working as before.
 *
 * @package Fort
 */

defined( 'ABSPATH' ) || exit;

define( 'FORT_THEME_VERSION', '0.1.0' );

require_once __DIR__ . '/inc/config.php';
require_once __DIR__ . '/inc/api.php';
require_once __DIR__ . '/inc/helpers.php';
require_once __DIR__ . '/inc/render.php';
require_once __DIR__ . '/inc/submit.php';

// ── Setup ─────────────────────────────────────────────────────────────

add_action(
	'after_setup_theme',
	function () {
		add_theme_support( 'title-tag' );
		add_theme_support( 'post-thumbnails' );
		add_theme_support( 'html5', array( 'search-form', 'gallery', 'caption', 'style', 'script' ) );
		add_theme_support( 'responsive-embeds' );
		register_nav_menus(
			array(
				'primary' => __( 'Main menu', 'fort' ),
				'footer'  => __( 'Footer menu', 'fort' ),
			)
		);
	}
);

add_action(
	'wp_enqueue_scripts',
	function () {
		wp_enqueue_style( 'fort-fonts', 'https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=JetBrains+Mono:wght@400;700&family=Source+Serif+4:ital,wght@0,400;0,600;1,400&display=swap', array(), null );
		wp_enqueue_style( 'fort', get_stylesheet_uri(), array( 'fort-fonts' ), FORT_THEME_VERSION );
		wp_add_inline_style( 'fort', ':root{--accent2:' . esc_attr( fort_accent2() ) . ';}' );
	}
);

add_action(
	'wp_head',
	function () {
		echo '<link rel="preconnect" href="https://fonts.googleapis.com">' . "\n";
	},
	1
);

// ── Customizer: second accent color ───────────────────────────────────

add_action(
	'customize_register',
	function ( $wp_customize ) {
		$wp_customize->add_setting(
			'fort_accent2',
			array(
				'default'           => '#8fb4d8',
				'sanitize_callback' => 'sanitize_hex_color',
			)
		);
		$wp_customize->add_control(
			new WP_Customize_Color_Control(
				$wp_customize,
				'fort_accent2',
				array(
					'label'       => __( 'Second accent', 'fort' ),
					'description' => __( 'Used for recurring/community items, backblasts and stats. Amber stays the primary accent.', 'fort' ),
					'section'     => 'colors',
				)
			)
		);

		$wp_customize->add_section( 'fort_newsletter', array( 'title' => __( 'The Fort Weekly', 'fort' ) ) );
		$wp_customize->add_setting( 'fort_subscribe_url', array( 'default' => '', 'sanitize_callback' => 'esc_url_raw' ) );
		$wp_customize->add_control(
			'fort_subscribe_url',
			array(
				'label'       => __( 'Newsletter sign-up link', 'fort' ),
				'description' => __( 'Shown as a "Subscribe" box on the homepage. Leave empty to hide it.', 'fort' ),
				'section'     => 'fort_newsletter',
				'type'        => 'url',
			)
		);
	}
);

// ── Routes: /events/<slug>/ and /submit/ ──────────────────────────────

add_action(
	'init',
	function () {
		add_rewrite_rule( '^events/([^/]+)/?$', 'index.php?fort_event=$matches[1]', 'top' );
		add_rewrite_rule( '^submit/?$', 'index.php?fort_submit=1', 'top' );
	}
);

add_filter(
	'query_vars',
	function ( $vars ) {
		$vars[] = 'fort_event';
		$vars[] = 'fort_submit';
		return $vars;
	}
);

add_action( 'after_switch_theme', 'flush_rewrite_rules' );

/** The current entry for /events/<slug>/ requests (loaded once). */
function fort_current_entry() {
	static $loaded = false, $data = null;
	if ( ! $loaded ) {
		$loaded = true;
		$slug   = get_query_var( 'fort_event' );
		$data   = $slug ? fort_entry( sanitize_title( $slug ) ) : null;
	}
	return $data;
}

add_filter(
	'template_include',
	function ( $template ) {
		if ( get_query_var( 'fort_submit' ) ) {
			return locate_template( 'submit.php' ) ?: $template;
		}
		if ( get_query_var( 'fort_event' ) ) {
			if ( ! fort_current_entry() ) {
				global $wp_query;
				$wp_query->set_404();
				status_header( 404 );
				nocache_headers();
				return get_404_template();
			}
			return locate_template( 'event.php' ) ?: $template;
		}
		return $template;
	}
);

// Don't let WordPress treat the virtual pages as the blog index.
add_action(
	'parse_query',
	function ( $q ) {
		if ( $q->is_main_query() && ( $q->get( 'fort_event' ) || $q->get( 'fort_submit' ) ) ) {
			$q->is_home = false;
			$q->is_page = true;
		}
	}
);

add_filter(
	'pre_get_document_title',
	function ( $title ) {
		if ( get_query_var( 'fort_submit' ) ) {
			return __( 'Submit an event', 'fort' ) . ' — ' . get_bloginfo( 'name' );
		}
		$data = get_query_var( 'fort_event' ) ? fort_current_entry() : null;
		return $data ? $data['entry']['title'] . ' — ' . get_bloginfo( 'name' ) : $title;
	}
);

// Share previews (Slack, iMessage, Facebook) for entry pages.
add_action(
	'wp_head',
	function () {
		$data = get_query_var( 'fort_event' ) ? fort_current_entry() : null;
		if ( ! $data ) {
			return;
		}
		$e     = $data['entry'];
		$desc  = fort_summary( $e, 30 );
		$image = fort_entry_image( $e );
		printf( '<meta name="description" content="%s">' . "\n", esc_attr( $desc ) );
		printf( '<meta property="og:title" content="%s">' . "\n", esc_attr( $e['title'] ) );
		printf( '<meta property="og:description" content="%s">' . "\n", esc_attr( $desc ) );
		printf( '<meta property="og:url" content="%s">' . "\n", esc_url( fort_event_url( $e ) ) );
		echo '<meta property="og:type" content="article">' . "\n";
		if ( $image ) {
			printf( '<meta property="og:image" content="%s">' . "\n", esc_url( $image ) );
		}
		printf( '<link rel="canonical" href="%s">' . "\n", esc_url( fort_event_url( $e ) ) );
	}
);

// ── Cache flush hook for the newsletter app ───────────────────────────

add_action(
	'rest_api_init',
	function () {
		register_rest_route(
			'fort/v1',
			'/flush',
			array(
				'methods'             => 'POST',
				'permission_callback' => '__return_true',
				'callback'            => function ( WP_REST_Request $req ) {
					$sent = (string) $req->get_header( 'x_fort_secret' );
					if ( '' === FORT_NL_SECRET || ! hash_equals( FORT_NL_SECRET, $sent ) ) {
						return new WP_Error( 'fort_forbidden', 'Forbidden', array( 'status' => 401 ) );
					}
					fort_flush_cache();
					return array( 'flushed' => true );
				},
			)
		);
	}
);
