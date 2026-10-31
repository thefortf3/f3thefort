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

define( 'FORT_THEME_VERSION', '0.5.3' );

require_once __DIR__ . '/inc/config.php';
require_once __DIR__ . '/inc/api.php';
require_once __DIR__ . '/inc/helpers.php';
require_once __DIR__ . '/inc/render.php';
require_once __DIR__ . '/inc/stats.php';
require_once __DIR__ . '/inc/locations.php';
require_once __DIR__ . '/inc/style-preview.php';

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
		if ( get_query_var( 'fort_submit' ) ) {
			wp_enqueue_script( 'fort-submit-preview', get_template_directory_uri() . '/assets/submit-preview.js', array(), FORT_THEME_VERSION, true );
			wp_enqueue_script( 'fort-submit-times', get_template_directory_uri() . '/assets/submit-times.js', array(), FORT_THEME_VERSION, true );
		}
		if ( is_front_page() ) {
			wp_enqueue_script( 'fort-home', get_template_directory_uri() . '/assets/home.js', array(), FORT_THEME_VERSION, true );
		}
	}
);

// Before the page draws: mark that JavaScript runs, and hide "Who we are" for visitors who asked
// (remembered in this browser; works behind the page cache). Without this it would flash in first.
add_action(
	'wp_head',
	function () {
		if ( is_front_page() ) {
			echo "<script>document.documentElement.classList.add('fort-js');try{if(localStorage.getItem('fortHideAbout')==='1'){document.documentElement.classList.add('fort-about-hidden');}}catch(e){}</script>\n";
		}
	},
	1
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
				'default'           => '#9fe8ff',
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

		$wp_customize->add_section(
			'fort_about',
			array(
				'title'       => __( 'Who we are', 'fort' ),
				'description' => __( 'The introduction on the homepage. Leave a box empty to use the default wording.', 'fort' ),
			)
		);
		$about_labels = array(
			'fort_about_heading' => array( __( 'Heading', 'fort' ), 'text' ),
			'fort_about_f3'      => array( __( 'What is F3', 'fort' ), 'textarea' ),
			'fort_about_fort'    => array( __( 'About The Fort', 'fort' ), 'textarea' ),
			'fort_about_fng'     => array( __( 'New here? note', 'fort' ), 'textarea' ),
		);
		foreach ( fort_about_defaults() as $key => $default ) {
			$wp_customize->add_setting( $key, array( 'default' => '', 'sanitize_callback' => 'sanitize_textarea_field' ) );
			$wp_customize->add_control(
				$key,
				array(
					'label'       => $about_labels[ $key ][0],
					'section'     => 'fort_about',
					'type'        => $about_labels[ $key ][1],
					'input_attrs' => array( 'placeholder' => $default ),
				)
			);
		}

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

// ── Routes: /submit/ (events at /events/<slug>/ are the plugin's post type) ──

add_action(
	'init',
	function () {
		add_rewrite_rule( '^submit/?$', 'index.php?fort_submit=1', 'top' );
		// One backblast, from the stats API (the archive is the "backblasts" page: page-backblasts.php).
		add_rewrite_rule( '^backblasts/([0-9]+)/?$', 'index.php?fort_bb=$matches[1]', 'top' );
	}
);

add_filter(
	'query_vars',
	function ( $vars ) {
		$vars[] = 'fort_submit';
		$vars[] = 'fort_bb';
		return $vars;
	}
);

/** True on an event page (the Fort Weekly plugin's fort_event post type). */
function fort_is_event_page() {
	return is_singular( 'fort_event' );
}

add_action( 'after_switch_theme', 'flush_rewrite_rules' );

/** The backblast for a /backblasts/<id>/ request (loaded once). */
function fort_current_backblast() {
	static $loaded = false, $bb = null;
	if ( ! $loaded ) {
		$loaded = true;
		$id     = (int) get_query_var( 'fort_bb' );
		$bb     = $id ? fort_backblast( $id ) : null;
	}
	return $bb;
}

/** The current event page's data (loaded once). WordPress has already checked who may see it. */
function fort_current_entry() {
	static $loaded = false, $data = null;
	if ( ! $loaded ) {
		$loaded = true;
		$data   = fort_is_event_page() ? fort_entry( get_queried_object() ) : null;
	}
	return $data;
}

add_filter(
	'template_include',
	function ( $template ) {
		if ( get_query_var( 'fort_submit' ) ) {
			// Never page-cache the form: it carries a nonce, and a cached copy would expire.
			if ( ! defined( 'DONOTCACHEPAGE' ) ) {
				define( 'DONOTCACHEPAGE', true );
			}
			nocache_headers();
			return locate_template( 'submit.php' ) ?: $template;
		}
		if ( get_query_var( 'fort_bb' ) ) {
			if ( ! fort_current_backblast() ) {
				global $wp_query;
				$wp_query->set_404();
				status_header( 404 );
				nocache_headers();
				return get_404_template();
			}
			return locate_template( 'backblast.php' ) ?: $template;
		}
		if ( fort_is_event_page() ) {
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
		if ( $q->is_main_query() && ( $q->get( 'fort_submit' ) || $q->get( 'fort_bb' ) ) ) {
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
		$bb = get_query_var( 'fort_bb' ) ? fort_current_backblast() : null;
		if ( $bb ) {
			return fort_backblast_title( $bb ) . ' — ' . get_bloginfo( 'name' );
		}
		$data = fort_current_entry();
		return $data ? $data['entry']['title'] . ' — ' . get_bloginfo( 'name' ) : $title;
	}
);

// Share previews (Slack, iMessage, Facebook) for entry pages.
add_action(
	'wp_head',
	function () {
		$data = fort_current_entry();
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

// Approvals and edits clear the page cache from the plugin (fortw_clear_page_cache()).
