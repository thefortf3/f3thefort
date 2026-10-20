<?php
/**
 * Importing the newsletter app's data (scripts/export-for-wordpress.mjs in that app).
 *
 * Re-runnable: events are matched on the app's id (_fort_legacy_id) and updated in place; tags on
 * their slug; images on their source URL, so nothing is downloaded or created twice. Region info
 * is replaced. A dry run reports what would happen without writing or downloading anything.
 *
 * Images the app hosted (/uploads/...) are copied into the media library from $uploads_base
 * (the app's public address, https://submit.f3thefort.com by default), and image links inside
 * descriptions are pointed at the copies.
 *
 * @package FortWeekly
 */

defined( 'ABSPATH' ) || exit;

/** True while an import runs, so approval side effects (Slack, pre-blast posts) stay off. */
function fortw_importing() {
	return ! empty( $GLOBALS['fortw_importing'] );
}

/**
 * Runs an import. $data: the decoded export. $opts: dry_run (bool), uploads_base (URL).
 * Returns a report: counts per kind plus a list of warnings.
 */
function fortw_import( $data, $opts = array() ) {
	$opts   = wp_parse_args( $opts, array( 'dry_run' => false, 'uploads_base' => 'https://submit.f3thefort.com' ) );
	$dry    = (bool) $opts['dry_run'];
	$report = array(
		'events_created' => 0, 'events_updated' => 0, 'tags_created' => 0, 'tags_updated' => 0,
		'images_copied' => 0, 'images_reused' => 0, 'region' => false, 'warnings' => array(),
	);
	if ( ! is_array( $data ) || ( $data['format'] ?? '' ) !== 'fort-weekly-export' || (int) ( $data['version'] ?? 0 ) !== 1 ) {
		$report['warnings'][] = __( 'This is not a Fort Weekly export (version 1).', 'fort-weekly' );
		return $report;
	}

	$GLOBALS['fortw_importing'] = true;
	$images = new FortW_Image_Copier( $opts['uploads_base'], $dry, $report );
	try {
		fortw_import_tags( $data['tags'] ?? array(), $dry, $report );
		foreach ( $data['entries'] ?? array() as $e ) {
			fortw_import_entry( $e, $dry, $images, $report );
		}
		fortw_import_region( $data['region'] ?? array(), $dry, $images, $report );
	} finally {
		$GLOBALS['fortw_importing'] = false;
		$images->done();
	}
	if ( ! $dry ) {
		update_option( 'fortw_next_dates_day', '', false ); // Recompute every sort key on the next read.
	}
	return $report;
}

function fortw_import_tags( $tags, $dry, &$report ) {
	foreach ( $tags as $t ) {
		$slug = sanitize_title( $t['slug'] ?? '' );
		if ( ! $slug ) {
			continue;
		}
		$term = get_term_by( 'slug', $slug, FORTW_TAX );
		$report[ $term ? 'tags_updated' : 'tags_created' ]++;
		if ( $dry ) {
			continue;
		}
		if ( ! $term ) {
			$made = wp_insert_term( sanitize_text_field( $t['label'] ), FORTW_TAX, array( 'slug' => $slug ) );
			if ( is_wp_error( $made ) ) {
				$report['warnings'][] = sprintf( 'Tag %s: %s', $slug, $made->get_error_message() );
				continue;
			}
			$term_id = $made['term_id'];
		} else {
			$term_id = $term->term_id;
			wp_update_term( $term_id, FORTW_TAX, array( 'name' => sanitize_text_field( $t['label'] ) ) );
		}
		update_term_meta( $term_id, 'fort_color', sanitize_hex_color( $t['color'] ?? '' ) ?: '#9a9da5' );
		update_term_meta( $term_id, 'fort_order', (int) ( $t['position'] ?? 0 ) );
	}
}

function fortw_find_by_legacy_id( $legacy_id ) {
	$ids = get_posts(
		array(
			'post_type'        => FORTW_POST_TYPE,
			'post_status'      => 'any',
			'posts_per_page'   => 1,
			'fields'           => 'ids',
			'suppress_filters' => true,
			'meta_key'         => '_fort_legacy_id',
			'meta_value'       => (int) $legacy_id,
		)
	);
	return $ids ? (int) $ids[0] : 0;
}

function fortw_import_status( $e ) {
	if ( ! empty( $e['archived'] ) ) {
		return 'fort_archived';
	}
	switch ( $e['status'] ?? 'pending' ) {
		case 'approved':
			return 'publish';
		case 'rejected':
			return 'fort_rejected';
		default:
			return 'pending';
	}
}

function fortw_import_entry( $e, $dry, $images, &$report ) {
	$legacy = (int) ( $e['legacy_id'] ?? 0 );
	$title  = sanitize_text_field( $e['title'] ?? '' );
	if ( ! $legacy || '' === $title ) {
		$report['warnings'][] = 'Skipped an entry without an id or title.';
		return;
	}
	$existing = fortw_find_by_legacy_id( $legacy );
	$report[ $existing ? 'events_updated' : 'events_created' ]++;

	$occ = array();
	try {
		$occ = fortw_normalize_occurrences( $e['occurrences'] ?? array() );
	} catch ( InvalidArgumentException $ex ) {
		$report['warnings'][] = sprintf( '%s: dates skipped (%s)', $title, $ex->getMessage() );
	}
	$hero = $e['hero_image'] ? $images->attachment_for( $e['hero_image'], $title ) : 0;
	if ( $dry ) {
		$images->rewrite_html( (string) ( $e['description'] ?? '' ) ); // Counts the images it would copy.
		return;
	}

	$created = ! empty( $e['created_at'] ) ? gmdate( 'Y-m-d H:i:s', strtotime( $e['created_at'] . ' UTC' ) ) : current_time( 'mysql', true );
	$postarr = array(
		'ID'            => $existing,
		'post_type'     => FORTW_POST_TYPE,
		'post_title'    => $title,
		'post_name'     => sanitize_title( $e['slug'] ?? $title ),
		'post_content'  => wp_kses_post( $images->rewrite_html( (string) ( $e['description'] ?? '' ) ) ),
		'post_status'   => fortw_import_status( $e ),
		'post_date_gmt' => $created,
		'post_date'     => get_date_from_gmt( $created ),
	);
	$id = wp_insert_post( wp_slash( $postarr ), true );
	if ( is_wp_error( $id ) ) {
		$report['warnings'][] = sprintf( '%s: %s', $title, $id->get_error_message() );
		return;
	}
	// WordPress blanks a pending post's slug unless the current user can publish (and an import
	// may run with no user); keep the app's slug so the event's address carries over.
	if ( '' === get_post_field( 'post_name', $id ) && '' !== $postarr['post_name'] ) {
		global $wpdb;
		$wpdb->update( $wpdb->posts, array( 'post_name' => $postarr['post_name'] ), array( 'ID' => $id ) );
		clean_post_cache( $id );
	}

	$text = function ( $v ) {
		return null === $v ? '' : sanitize_text_field( (string) $v );
	};
	$meta = array(
		'_fort_legacy_id'          => $legacy,
		'_fort_leader'             => $text( $e['leader'] ?? '' ),
		'_fort_location'           => $text( $e['location'] ?? '' ),
		'_fort_summary'            => sanitize_textarea_field( (string) ( $e['summary'] ?? '' ) ),
		'_fort_link'               => fortw_http_url( $e['link'] ?? '' ),
		'_fort_video_url'          => fortw_http_url( $e['video_url'] ?? '' ),
		'_fort_preblast_url'       => fortw_http_url( $e['preblast_url'] ?? '' ),
		'_fort_hold'               => empty( $e['hold_from_newsletter'] ) ? '' : '1',
		'_fort_preblast_requested' => empty( $e['preblast_requested'] ) ? '' : '1',
		'_fort_approved_at'        => $text( $e['approved_at'] ?? '' ),
		'_fort_reject_reason'      => sanitize_textarea_field( (string) ( $e['reject_reason'] ?? '' ) ),
		'_fort_origin'             => $text( $e['origin'] ?? 'import' ),
		'_fort_submitter_name'     => $text( $e['submitter']['name'] ?? '' ),
		'_fort_submitter_email'    => sanitize_email( (string) ( $e['submitter']['email'] ?? '' ) ),
		'_fort_submitter_phone'    => $text( $e['submitter']['phone'] ?? '' ),
	);
	foreach ( $meta as $key => $value ) {
		if ( '' === $value || null === $value ) {
			delete_post_meta( $id, $key );
		} else {
			update_post_meta( $id, $key, $value );
		}
	}
	fortw_set_occurrences( $id, $occ );
	fortw_set_featured( $id, ! empty( $e['featured'] ) );
	wp_set_object_terms( $id, array_map( 'sanitize_title', (array) ( $e['tags'] ?? array() ) ), FORTW_TAX );
	if ( $hero ) {
		set_post_thumbnail( $id, $hero );
	} else {
		delete_post_thumbnail( $id );
	}
}

function fortw_import_region( $r, $dry, $images, &$report ) {
	$clean = function ( $list, $fields ) {
		$out = array();
		foreach ( (array) $list as $row ) {
			$item = array();
			foreach ( $fields as $f => $kind ) {
				$v          = (string) ( $row[ $f ] ?? '' );
				$item[ $f ] = 'url' === $kind ? fortw_http_url( $v ) : sanitize_text_field( $v );
			}
			$out[] = $item;
		}
		return $out;
	};
	$settings = fortw_region_settings();
	$n        = (array) ( $r['nantan'] ?? array() );
	$settings['nantan'] = array(
		'text'     => wp_kses_post( $images->rewrite_html( (string) ( $n['text'] ?? '' ) ) ),
		'author'   => sanitize_text_field( (string) ( $n['author'] ?? '' ) ),
		'heading'  => sanitize_text_field( (string) ( $n['heading'] ?? '' ) ),
		'image_id' => ! empty( $n['image'] ) ? $images->attachment_for( $n['image'], "Nan'tan note" ) : 0,
	);
	$settings['three_fs']     = $clean( $r['three_fs'] ?? array(), array( 'column' => 'text', 'type' => 'text', 'name' => 'text', 'detail' => 'text', 'label' => 'text', 'url' => 'url' ) );
	$settings['slt']          = $clean( $r['slt'] ?? array(), array( 'role' => 'text', 'name' => 'text' ) );
	$settings['links']        = $clean( $r['links'] ?? array(), array( 'label' => 'text', 'name' => 'text', 'url' => 'url' ) );
	$settings['shovel_flags'] = $clean( $r['shovel_flags'] ?? array(), array( 'from' => 'text', 'to' => 'text', 'ao' => 'text' ) );
	$settings['vqs']          = $clean( $r['vqs'] ?? array(), array( 'name' => 'text', 'ao' => 'text' ) );
	$report['region']         = true;
	if ( ! $dry ) {
		update_option( 'fort_weekly_region', $settings );
	}
}

/**
 * Copies the app's hosted images into the media library, once each. Only image files from the
 * app's own /uploads/ (relative, or under $uploads_base) are copied; other URLs are left alone.
 */
class FortW_Image_Copier {
	private $base;
	private $dry;
	private $report;
	private $seen = array();

	public function __construct( $uploads_base, $dry, &$report ) {
		$this->base   = untrailingslashit( (string) $uploads_base );
		$this->dry    = $dry;
		$this->report = &$report;
		// The app may be on a private address or an unusual port (e.g. the local stack); allow that
		// one host for the import's downloads only.
		add_filter( 'http_request_host_is_external', array( $this, 'allow_source_host' ), 10, 2 );
		add_filter( 'http_allowed_safe_ports', array( $this, 'allow_source_port' ) );
	}

	public function done() {
		remove_filter( 'http_request_host_is_external', array( $this, 'allow_source_host' ), 10 );
		remove_filter( 'http_allowed_safe_ports', array( $this, 'allow_source_port' ) );
	}

	public function allow_source_host( $external, $host ) {
		return $host === wp_parse_url( $this->base, PHP_URL_HOST ) ? true : $external;
	}

	public function allow_source_port( $ports ) {
		$port = wp_parse_url( $this->base, PHP_URL_PORT );
		if ( $port ) {
			$ports[] = (int) $port;
		}
		return $ports;
	}

	/** The app URL for an image reference, or '' if it isn't one of the app's uploads. */
	private function source_url( $ref ) {
		$ref = trim( (string) $ref );
		if ( 0 === strpos( $ref, '/uploads/' ) ) {
			$ref = $this->base . $ref;
		}
		if ( 0 !== strpos( $ref, $this->base . '/uploads/' ) || ! preg_match( '/\.(png|jpe?g|gif|webp)$/i', wp_parse_url( $ref, PHP_URL_PATH ) ) ) {
			return '';
		}
		return $ref;
	}

	/** The media-library attachment id for an image reference, copying it the first time. 0 if not possible. */
	public function attachment_for( $ref, $title ) {
		$url = $this->source_url( $ref );
		if ( ! $url ) {
			return 0;
		}
		if ( isset( $this->seen[ $url ] ) ) {
			return $this->seen[ $url ];
		}
		$existing = get_posts(
			array(
				'post_type'        => 'attachment',
				'post_status'      => 'inherit',
				'posts_per_page'   => 1,
				'fields'           => 'ids',
				'suppress_filters' => true,
				'meta_key'         => '_fort_source_url',
				'meta_value'       => $url,
			)
		);
		if ( $existing ) {
			$this->report['images_reused']++;
			return $this->seen[ $url ] = (int) $existing[0];
		}
		$this->report['images_copied']++;
		if ( $this->dry ) {
			return $this->seen[ $url ] = 0;
		}
		require_once ABSPATH . 'wp-admin/includes/media.php';
		require_once ABSPATH . 'wp-admin/includes/file.php';
		require_once ABSPATH . 'wp-admin/includes/image.php';
		$id = media_sideload_image( $url, 0, $title, 'id' );
		if ( is_wp_error( $id ) ) {
			$this->report['images_copied']--;
			$this->report['warnings'][] = sprintf( 'Image %s: %s', $url, $id->get_error_message() );
			return $this->seen[ $url ] = 0;
		}
		update_post_meta( $id, '_fort_source_url', $url );
		return $this->seen[ $url ] = (int) $id;
	}

	/** Points <img src> / <a href> at the app's uploads to their media-library copies. */
	public function rewrite_html( $html ) {
		return preg_replace_callback(
			'/\b(src|href)="([^"]+)"/i',
			function ( $m ) {
				if ( ! $this->source_url( $m[2] ) ) {
					return $m[0];
				}
				$id  = $this->attachment_for( $m[2], '' );
				$new = $id ? wp_get_attachment_url( $id ) : '';
				return $new ? $m[1] . '="' . esc_url( $new ) . '"' : $m[0];
			},
			$html
		);
	}
}

if ( defined( 'WP_CLI' ) && WP_CLI ) {
	/**
	 * Imports the newsletter app's export (scripts/export-for-wordpress.mjs).
	 *
	 * ## OPTIONS
	 *
	 * <file>
	 * : The export JSON file, or - to read it from standard input.
	 *
	 * [--dry-run]
	 * : Report what would change without writing or downloading anything.
	 *
	 * [--uploads-base=<url>]
	 * : The app's address, for copying its hosted images. Default: https://submit.f3thefort.com
	 */
	WP_CLI::add_command(
		'fort-weekly import',
		function ( $args, $assoc ) {
			$json = file_get_contents( '-' === $args[0] ? 'php://stdin' : $args[0] ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
			if ( false === $json ) {
				WP_CLI::error( 'Could not read ' . $args[0] );
			}
			$report = fortw_import(
				json_decode( $json, true ),
				array(
					'dry_run'      => isset( $assoc['dry-run'] ),
					'uploads_base' => $assoc['uploads-base'] ?? 'https://submit.f3thefort.com',
				)
			);
			foreach ( $report['warnings'] as $w ) {
				WP_CLI::warning( $w );
			}
			unset( $report['warnings'] );
			WP_CLI::success( ( isset( $assoc['dry-run'] ) ? 'Dry run: ' : '' ) . wp_json_encode( $report ) );
		}
	);
}
