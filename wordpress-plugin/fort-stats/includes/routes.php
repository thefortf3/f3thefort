<?php
/**
 * Public, read-only JSON at /wp-json/fort-stats/v1/…, mirroring stats.f3thefort.com's /api/*
 * (the same paths, arguments and answers), for the /stats/ pages and anyone else.
 *
 * @package FortStats
 */

defined( 'ABSPATH' ) || exit;

const FSTATS_NS = 'fort-stats/v1';

add_action(
	'rest_api_init',
	function () {
		$routes = array(
			'/core'                         => fn( $r ) => fstats_get_core(),
			'/month/(?P<key>[^/]+)'         => fn( $r ) => fstats_get_month( $r['key'] ),
			'/streaks'                      => fn( $r ) => fstats_get_streaks(),
			'/backblasts'                   => fn( $r ) => fstats_get_backblasts( $r['days'] ?? 7, $r['limit'] ?? 12 ),
			'/backblasts/summary'           => fn( $r ) => fstats_get_backblast_summary(),
			'/backblasts/archive'           => fn( $r ) => fstats_get_backblast_archive( $r->get_query_params() ),
			'/backblasts/(?P<id>\d+)'       => fn( $r ) => fstats_get_backblast( $r['id'] ),
			'/schedule'                     => fn( $r ) => fstats_get_schedule( $r['days'] ?? 7 ),
			'/map'                          => fn( $r ) => fstats_get_map(),
			'/fng'                          => fn( $r ) => fstats_get_fng(),
		);
		foreach ( $routes as $path => $get ) {
			register_rest_route(
				FSTATS_NS,
				$path,
				array(
					'methods'             => 'GET',
					'permission_callback' => '__return_true',
					'callback'            => function ( WP_REST_Request $r ) use ( $get ) {
						list( $status, $data ) = $get( $r );
						return fstats_rest_response( $status, $data );
					},
				)
			);
		}
	}
);

/** The payload as JSON, or the Flask API's error bodies. */
function fstats_rest_response( $status, $data ) {
	$errors = array( 400 => 'bad month', 404 => 'Not found', 503 => 'Stats are unavailable right now' );
	if ( 200 !== $status ) {
		$res = new WP_REST_Response( array( 'error' => $errors[ $status ] ?? 'error' ), $status );
		$res->header( 'Cache-Control', 'no-store' );
		return $res;
	}
	// Python's empty dicts are {} in JSON, not [].
	foreach ( array( 'ao_sparklines', 'aos' ) as $map ) {
		if ( isset( $data[ $map ] ) && array() === $data[ $map ] && ( 'aos' !== $map || isset( $data['configured'] ) ) ) {
			$data[ $map ] = new stdClass();
		}
	}
	$res = new WP_REST_Response( $data, 200 );
	$res->header( 'Cache-Control', 'public, max-age=300' );
	return $res;
}

// Whole numbers stored as floats (averages) keep their ".0", as in Python's JSON.
add_filter(
	'rest_json_encode_options',
	function ( $options, $request ) {
		return str_starts_with( (string) $request->get_route(), '/' . FSTATS_NS . '/' ) ? $options | JSON_PRESERVE_ZERO_FRACTION | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE : $options;
	},
	10,
	2
);
