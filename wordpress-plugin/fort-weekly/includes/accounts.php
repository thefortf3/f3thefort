<?php
/**
 * Account names stay private: logged-out visitors can't list the site's accounts or find their
 * login names (half of what's needed to break in). WordPress shows them by default through the
 * users API (/wp-json/wp/v2/users), ?author=N (which redirects to /author/<login>/), the author
 * pages, the users sitemap, embeds of a post, and a login error that says which username exists.
 * The theme never links to author pages, so they are simply not found. Logged-in users (the
 * editor's author list uses the users API) are unaffected.
 *
 * @package FortWeekly
 */

defined( 'ABSPATH' ) || exit;

add_filter(
	'rest_endpoints',
	function ( $endpoints ) {
		if ( is_user_logged_in() ) {
			return $endpoints;
		}
		foreach ( array_keys( $endpoints ) as $route ) {
			if ( 0 === strpos( $route, '/wp/v2/users' ) ) {
				unset( $endpoints[ $route ] );
			}
		}
		return $endpoints;
	}
);

add_action(
	'template_redirect',
	function () {
		if ( ! is_user_logged_in() && ( is_author() || isset( $_GET['author'] ) ) ) { // phpcs:ignore WordPress.Security.NonceVerification -- read-only
			global $wp_query;
			$wp_query->set_404();
			status_header( 404 );
			nocache_headers();
		}
	},
	1 // Before redirect_canonical(), which turns ?author=N into /author/<login>/.
);

add_filter(
	'wp_sitemaps_add_provider',
	function ( $provider, $name ) {
		return 'users' === $name ? false : $provider;
	},
	10,
	2
);

// A post embedded elsewhere names the site, not its author's account.
add_filter(
	'oembed_response_data',
	function ( $data ) {
		$data['author_name'] = get_bloginfo( 'name' );
		$data['author_url']  = home_url( '/' );
		return $data;
	}
);

// The same answer for a wrong username and a wrong password.
add_filter(
	'authenticate',
	function ( $user ) {
		if ( is_wp_error( $user ) && array_intersect( $user->get_error_codes(), array( 'invalid_username', 'invalid_email', 'incorrect_password' ) ) ) {
			return new WP_Error(
				'incorrect_password',
				'<strong>' . esc_html__( 'Error:', 'fort-weekly' ) . '</strong> ' . esc_html__( 'The username or password is incorrect.', 'fort-weekly' ) . ' <a href="' . esc_url( wp_lostpassword_url() ) . '">' . esc_html__( 'Lost your password?', 'fort-weekly' ) . '</a>'
			);
		}
		return $user;
	},
	99
);
