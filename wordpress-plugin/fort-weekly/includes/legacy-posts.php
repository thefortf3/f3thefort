<?php
/**
 * The site's backblast and pre-blast posts as tidy records (see includes/pure/legacy-posts.php).
 *
 * Nothing in the posts themselves changes: each record is stored beside its post (the
 * `_fort_bb` field) and rebuilt whenever the post is edited or the converter improves. Records
 * are made on first view, or all at once with `wp fort-weekly convert-posts`.
 *
 * Also keeps Slackblast working: it posts backblasts through the REST API with `qic` and
 * `workout_date` fields, which the site's previous theme registered.
 *
 * @package FortWeekly
 */

defined( 'ABSPATH' ) || exit;

/**
 * The record for a post (made and stored if missing or out of date), or null for anything that
 * isn't a post.
 *
 * @param int|WP_Post $post
 * @param bool        $save Store a newly made record.
 */
function fortw_post_record( $post, $save = true ) {
	$post = get_post( $post );
	if ( ! $post || 'post' !== $post->post_type ) {
		return null;
	}
	$r = get_post_meta( $post->ID, '_fort_bb', true );
	if ( is_array( $r ) && ( $r['v'] ?? 0 ) === FORTW_LP_VERSION && ( $r['modified'] ?? '' ) === $post->post_modified_gmt ) {
		return $r;
	}
	$r = fortw_convert_post( $post );
	if ( $save ) {
		update_post_meta( $post->ID, '_fort_bb', wp_slash( $r ) );
	}
	return $r;
}

/** Builds a post's record from its fields, categories and tags. */
function fortw_convert_post( WP_Post $post ) {
	$meta = array();
	foreach ( array( 'qic', 'workout_date', 'the_pax' ) as $k ) {
		$meta[ $k ] = (string) get_post_meta( $post->ID, $k, true );
	}
	$r = fortw_lp_convert(
		array(
			'title'      => $post->post_title,
			'post_date'  => $post->post_date,
			'content'    => $post->post_content,
			'categories' => wp_list_pluck( get_the_category( $post->ID ), 'name' ),
			'tags'       => wp_list_pluck( (array) get_the_tags( $post->ID ), 'name' ),
			'meta'       => $meta,
		)
	);
	// Paragraphs, embeds' shortcodes, then only the tags posts may use.
	$html            = wp_kses_post( wpautop( $r['body_html'] ) );
	$html            = preg_replace( '/<p>\s*(<h3 class="fort-bb-label">[^<]*<\/h3>)\s*<\/p>/', '$1', $html );
	$html            = preg_replace( '/<p>(?:\s|&nbsp;|<br\s*\/?>)*<\/p>/', '', $html );
	$r['body_html']  = trim( $html );
	$r['post_id']    = $post->ID;
	$r['modified']   = $post->post_modified_gmt;
	return $r;
}

// Slackblast: the Q and workout date it sends with each backblast (as the previous theme allowed).
add_action(
	'rest_api_init',
	function () {
		foreach ( array( 'qic', 'workout_date' ) as $field ) {
			register_rest_field(
				'post',
				$field,
				array(
					'get_callback'    => function ( $obj ) use ( $field ) {
						return get_post_meta( $obj['id'], $field );
					},
					'update_callback' => function ( $value, $post ) use ( $field ) {
						return (bool) update_post_meta( $post->ID, $field, sanitize_text_field( is_array( $value ) ? (string) reset( $value ) : (string) $value ) );
					},
					'schema'          => null,
				)
			);
		}
	}
);

/**
 * Converts every post. Returns counts for the report.
 *
 * @param bool $dry_run Build records without storing them.
 */
function fortw_convert_all_posts( $dry_run = false, $progress = null ) {
	global $wpdb;
	$ids    = $wpdb->get_col( "SELECT ID FROM {$wpdb->posts} WHERE post_type = 'post' AND post_status IN ('publish','private','draft','future') ORDER BY ID" ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
	$report = array(
		'posts'          => count( $ids ),
		'kinds'          => array(),
		'no_date'        => 0,
		'no_q'           => 0,
		'no_ao'          => 0,
		'with_pax'       => 0,
		'fngs'           => 0,
		'aos'            => array(),
		'topics'         => array(),
	);
	foreach ( array_chunk( $ids, 200 ) as $chunk ) {
		_prime_post_caches( $chunk, true, true );
		foreach ( $chunk as $id ) {
			$r = $dry_run ? fortw_convert_post( get_post( $id ) ) : fortw_post_record( $id );
			$report['kinds'][ $r['kind'] ] = ( $report['kinds'][ $r['kind'] ] ?? 0 ) + 1;
			if ( 'post' !== $r['kind'] ) {
				$report['no_date'] += $r['date'] ? 0 : 1;
				$report['no_q']    += $r['qs'] ? 0 : 1;
				$report['no_ao']   += $r['ao'] ? 0 : 1;
			}
			$report['with_pax'] += $r['pax'] ? 1 : 0;
			$report['fngs']     += $r['fng_count'];
			if ( $r['ao'] ) {
				$report['aos'][ $r['ao'] ] = ( $report['aos'][ $r['ao'] ] ?? 0 ) + 1;
			}
			foreach ( $r['topics'] as $t ) {
				$report['topics'][ $t ] = ( $report['topics'][ $t ] ?? 0 ) + 1;
			}
		}
		if ( $progress ) {
			$progress( count( $chunk ) );
		}
		wp_cache_flush_runtime();
	}
	arsort( $report['aos'] );
	arsort( $report['topics'] );
	return $report;
}

if ( defined( 'WP_CLI' ) && WP_CLI ) {
	/**
	 * Builds the tidy record for every post (backblasts, pre-blasts, announcements). Safe to run
	 * again; the posts themselves are not changed.
	 *
	 * ## OPTIONS
	 *
	 * [--dry-run]
	 * : Build and count the records without storing them.
	 */
	WP_CLI::add_command(
		'fort-weekly convert-posts',
		function ( $args, $assoc ) {
			$bar    = null;
			$report = fortw_convert_all_posts(
				isset( $assoc['dry-run'] ),
				function ( $n ) use ( &$bar ) {
					if ( ! $bar ) {
						$bar = \WP_CLI\Utils\make_progress_bar( 'Converting posts', (int) wp_count_posts()->publish );
					}
					for ( $i = 0; $i < $n; $i++ ) {
						$bar->tick();
					}
				}
			);
			if ( $bar ) {
				$bar->finish();
			}
			WP_CLI::log( wp_json_encode( $report, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE ) );
			WP_CLI::success( ( isset( $assoc['dry-run'] ) ? 'Dry run: ' : '' ) . $report['posts'] . ' posts.' );
		}
	);
}
