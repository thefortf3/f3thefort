<?php
/**
 * Loading events into the plain "entry" arrays the rest of the plugin (and the theme) works with,
 * and saving dates, tags and flags back. The entry shape matches the old app's entries
 * (lib/entries.js attach()) so the ported selection and rendering code can stay the same.
 *
 * @package FortWeekly
 */

defined( 'ABSPATH' ) || exit;

/** WordPress status → the entry's approval status. */
function fortw_status_of( $post_status ) {
	switch ( $post_status ) {
		case 'publish':
			return 'approved';
		case 'fort_rejected':
			return 'rejected';
		default:
			return 'pending'; // pending, draft, fort_archived (which also sets archived).
	}
}

function fortw_meta( $post_id, $key ) {
	return get_post_meta( $post_id, $key, true );
}

/** The event's dates: always a normalized array (bad stored data comes back as no dates). */
function fortw_get_occurrences( $post_id ) {
	$occ = fortw_meta( $post_id, '_fort_occurrences' );
	if ( ! is_array( $occ ) ) {
		return array();
	}
	try {
		return fortw_normalize_occurrences( $occ );
	} catch ( InvalidArgumentException $e ) {
		return array();
	}
}

/** Validates, stores and indexes the event's dates. Throws InvalidArgumentException on a bad date. */
function fortw_set_occurrences( $post_id, $occurrences ) {
	$occ = fortw_normalize_occurrences( $occurrences );
	update_post_meta( $post_id, '_fort_occurrences', $occ );
	update_post_meta( $post_id, '_fort_next_date', fortw_next_date_key( $occ, fortw_today() ) );
	update_post_meta( $post_id, '_fort_last_date', fortw_final_day( $occ ) );
	return $occ;
}

// Once: the events saved before times were converted take the 24-hour form too (every save
// converts them from now on, in fortw_normalize_occurrences()).
add_action(
	'init',
	function () {
		if ( '1' === get_option( 'fortw_times_24h' ) ) {
			return;
		}
		$ids = get_posts( array( 'post_type' => FORTW_POST_TYPE, 'post_status' => array_keys( get_post_stati() ), 'numberposts' => -1, 'fields' => 'ids' ) );
		foreach ( $ids as $id ) {
			try {
				fortw_set_occurrences( $id, fortw_get_occurrences( $id ) );
			} catch ( InvalidArgumentException $e ) {
				continue; // A bad date: left as it is.
			}
		}
		update_option( 'fortw_times_24h', '1' );
	},
	20
);

/** Tags in display order (term meta fort_order, then name), with colours. */
function fortw_all_tags() {
	$terms = get_terms( array( 'taxonomy' => FORTW_TAX, 'hide_empty' => false ) );
	if ( is_wp_error( $terms ) ) {
		return array();
	}
	$tags = array_map( 'fortw_tag_shape', $terms );
	usort(
		$tags,
		function ( $a, $b ) {
			return ( $a['order'] <=> $b['order'] ) ?: strcasecmp( $a['label'], $b['label'] );
		}
	);
	return $tags;
}

function fortw_tag_shape( $term ) {
	$color = get_term_meta( $term->term_id, 'fort_color', true );
	return array(
		'id'    => (int) $term->term_id,
		'label' => $term->name,
		'slug'  => $term->slug,
		'color' => $color ? $color : '#9a9da5',
		'order' => (int) get_term_meta( $term->term_id, 'fort_order', true ),
		'count' => (int) $term->count,
	);
}

/** The event's tags, in the same display order as fortw_all_tags(). */
function fortw_post_tags( $post_id ) {
	$terms = get_the_terms( $post_id, FORTW_TAX );
	if ( ! $terms || is_wp_error( $terms ) ) {
		return array();
	}
	$tags = array_map(
		function ( $t ) {
			$s = fortw_tag_shape( $t );
			unset( $s['count'] );
			return $s;
		},
		$terms
	);
	usort(
		$tags,
		function ( $a, $b ) {
			return ( $a['order'] <=> $b['order'] ) ?: strcasecmp( $a['label'], $b['label'] );
		}
	);
	return array_map(
		function ( $t ) {
			unset( $t['order'] );
			return $t;
		},
		$tags
	);
}

/** The hero/flyer image URL (the featured image), or null. */
function fortw_hero_url( $post_id ) {
	$id = get_post_thumbnail_id( $post_id );
	if ( ! $id ) {
		return null;
	}
	$url = wp_get_attachment_image_url( $id, 'large' );
	return $url ? $url : null;
}

/**
 * For an event with a flyer: a test of whether a description image (its src) is that flyer again,
 * either the same upload (at any size) or another upload of the same file. Null without a flyer.
 */
function fortw_flyer_copy_test( $post_id ) {
	$file = get_attached_file( get_post_thumbnail_id( $post_id ) );
	if ( ! $file || ! is_readable( $file ) ) {
		return null;
	}
	$uploads = wp_get_upload_dir();
	$base    = untrailingslashit( (string) wp_parse_url( $uploads['baseurl'], PHP_URL_PATH ) );
	$size    = filesize( $file );
	$hash    = null;
	return function ( $src ) use ( $file, $uploads, $base, $size, &$hash ) {
		$path = rawurldecode( (string) wp_parse_url( $src, PHP_URL_PATH ) );
		if ( '' === $base || 0 !== strpos( $path, $base . '/' ) || false !== strpos( $path, '..' ) ) {
			return false; // Not one of our uploads (the host can differ: develop.lan, f3beta…).
		}
		$local = $uploads['basedir'] . substr( $path, strlen( $base ) );
		if ( preg_replace( '/-\d+x\d+(?=\.\w+$)/', '', $local ) === $file || $local === $file ) {
			return true;
		}
		if ( ! is_readable( $local ) || filesize( $local ) !== $size ) {
			return false;
		}
		$hash = $hash ?? md5_file( $file );
		return md5_file( $local ) === $hash;
	};
}

/**
 * An event as an entry array. Never includes submitter details: use fortw_entry_private() for
 * those, in admin screens only.
 */
function fortw_entry( $post, $today = null ) {
	$post  = get_post( $post );
	$today = $today ? $today : fortw_today();
	$id    = $post->ID;
	$occ   = fortw_get_occurrences( $id );
	$pre   = (int) fortw_meta( $id, '_fort_preblast_post_id' );
	$pre_url = $pre && 'publish' === get_post_status( $pre ) ? get_permalink( $pre ) : fortw_meta( $id, '_fort_preblast_url' );

	$entry = array(
		'id'                   => $id,
		'slug'                 => $post->post_name ? $post->post_name : (string) $id,
		'title'                => $post->post_title, // Plain text; get_the_title() would add HTML entities.
		'leader'               => fortw_meta( $id, '_fort_leader' ) ?: null,
		'location'             => fortw_meta( $id, '_fort_location' ) ?: null,
		'description'          => $post->post_content,
		'summary'              => fortw_meta( $id, '_fort_summary' ) ?: null,
		'hero_image'           => fortw_hero_url( $id ),
		'link'                 => fortw_meta( $id, '_fort_link' ) ?: null,
		'video_url'            => fortw_meta( $id, '_fort_video_url' ) ?: null,
		'preblast_url'         => $pre_url ? $pre_url : null,
		'featured'             => (bool) fortw_meta( $id, '_fort_featured' ),
		'hold_from_newsletter' => (bool) fortw_meta( $id, '_fort_hold' ),
		'preblast_requested'   => (bool) fortw_meta( $id, '_fort_preblast_requested' ),
		'approved_at'          => fortw_meta( $id, '_fort_approved_at' ) ?: null,
		'reject_reason'        => fortw_meta( $id, '_fort_reject_reason' ) ?: null,
		'origin'               => fortw_meta( $id, '_fort_origin' ) ?: null,
		'created_at'           => $post->post_date_gmt,
		'status'               => fortw_status_of( $post->post_status ),
		'archived'             => 'fort_archived' === $post->post_status,
		'occurrences'          => $occ,
		'tags'                 => fortw_post_tags( $id ),
	);
	$entry['archived_at']     = $entry['archived'] ? $post->post_modified_gmt : null; // Old-app field name.
	$entry['next_occurrence'] = fortw_next_occurrence( $occ, $today );
	$entry['lifecycle']       = fortw_lifecycle( $entry, $today );
	return $entry;
}

/** Submitter contact details, for editors only. */
function fortw_entry_private( $post_id ) {
	return array(
		'name'  => fortw_meta( $post_id, '_fort_submitter_name' ),
		'email' => fortw_meta( $post_id, '_fort_submitter_email' ),
		'phone' => fortw_meta( $post_id, '_fort_submitter_phone' ),
	);
}

/**
 * Events as entry arrays, sorted by next date (fortw_compare_entries).
 * $args: statuses (WordPress post statuses, default publish), upcoming_only (skip events whose
 * dates have all passed; keeps undated ones), today.
 */
function fortw_list_entries( $args = array() ) {
	$args  = wp_parse_args( $args, array( 'statuses' => array( 'publish' ), 'upcoming_only' => false, 'today' => null ) );
	$today = $args['today'] ? $args['today'] : fortw_today();
	fortw_refresh_next_dates( $today );

	$query = array(
		'post_type'              => FORTW_POST_TYPE,
		'post_status'            => $args['statuses'],
		'posts_per_page'         => -1,
		'no_found_rows'          => true,
		'suppress_filters'       => true,
		'update_post_term_cache' => true,
		'update_post_meta_cache' => true,
	);
	if ( $args['upcoming_only'] ) {
		$query['meta_query'] = array( array( 'key' => '_fort_next_date', 'value' => $today, 'compare' => '>=' ) );
	}
	$entries = array_map(
		function ( $p ) use ( $today ) {
			return fortw_entry( $p, $today );
		},
		get_posts( $query )
	);
	usort( $entries, 'fortw_compare_entries' );
	return $entries;
}

/** A published event by slug, or null. */
function fortw_entry_by_slug( $slug, $today = null ) {
	$posts = get_posts(
		array(
			'post_type'        => FORTW_POST_TYPE,
			'name'             => sanitize_title( $slug ),
			'post_status'      => 'publish',
			'posts_per_page'   => 1,
			'suppress_filters' => true,
		)
	);
	return $posts ? fortw_entry( $posts[0], $today ) : null;
}

/**
 * Keeps _fort_next_date current as days pass: once per day, recomputes every event whose stored
 * next date is already behind today. Runs from the daily cron and, as a fallback (WP-Cron only
 * fires on visits), on the first read of the day.
 */
function fortw_refresh_next_dates( $today = null ) {
	$today = $today ? $today : fortw_today();
	if ( get_option( 'fortw_next_dates_day' ) === $today ) {
		return;
	}
	$stale = get_posts(
		array(
			'post_type'        => FORTW_POST_TYPE,
			'post_status'      => 'any',
			'posts_per_page'   => -1,
			'fields'           => 'ids',
			'suppress_filters' => true,
			'meta_query'       => array(
				'relation' => 'OR',
				array( 'key' => '_fort_next_date', 'compare' => 'NOT EXISTS' ),
				array(
					'key'     => '_fort_next_date',
					'value'   => array( '0000-00-01', fortw_add_days( $today, -1 ) ),
					'compare' => 'BETWEEN',
				),
			),
		)
	);
	foreach ( $stale as $id ) {
		update_post_meta( $id, '_fort_next_date', fortw_next_date_key( fortw_get_occurrences( $id ), $today ) );
	}
	update_option( 'fortw_next_dates_day', $today, false );
}
add_action( 'fortw_daily', 'fortw_refresh_next_dates' );

/** Makes $post_id the only featured event. */
function fortw_set_featured( $post_id, $on ) {
	if ( $on ) {
		$others = get_posts(
			array(
				'post_type'        => FORTW_POST_TYPE,
				'post_status'      => 'any',
				'posts_per_page'   => -1,
				'fields'           => 'ids',
				'suppress_filters' => true,
				'meta_key'         => '_fort_featured',
				'meta_value'       => '1',
			)
		);
		foreach ( $others as $other ) {
			if ( (int) $other !== (int) $post_id ) {
				delete_post_meta( $other, '_fort_featured' );
			}
		}
		update_post_meta( $post_id, '_fort_featured', '1' );
	} else {
		delete_post_meta( $post_id, '_fort_featured' );
	}
}

/** Only http(s) URLs are kept for links shown to visitors. */
function fortw_http_url( $url ) {
	$url = trim( (string) $url );
	return preg_match( '#^https?://#i', $url ) ? esc_url_raw( $url ) : '';
}
