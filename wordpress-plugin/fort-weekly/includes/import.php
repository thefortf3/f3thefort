<?php
/**
 * Importing the newsletter app's data (scripts/export-for-wordpress.mjs in that app).
 *
 * Re-runnable: events are matched on the app's id (_fort_legacy_id); tags on their slug; images on
 * their source URL, so nothing is downloaded or created twice. By default a re-run only adds what
 * is new and leaves events (and region info) already here alone, so edits made in WordPress
 * survive; update_existing overwrites them from the file. A dry run reports what would happen
 * without writing or downloading anything.
 *
 * Images the app hosted (/uploads/...) are copied into the media library from $uploads_base
 * (the app's public address, https://submit.f3thefort.com by default), and image links inside
 * descriptions are pointed at the copies.
 *
 * Copying images is slow on shared hosting (WordPress makes every smaller size, and plugins may
 * add their own copies), so an import is a job that runs in steps: fortw_import_start() checks
 * the file, fortw_import_run() works until its time is up and records where it stopped. The
 * wp-admin screen runs one short step per page load; the CLI runs them all at once. Each copied
 * image is tagged with its source URL as soon as WordPress creates it, so a step that dies
 * part-way never downloads that image again, and the next step finishes its missing sizes.
 *
 * @package FortWeekly
 */

defined( 'ABSPATH' ) || exit;

/** True while an import runs, so approval side effects (Slack, pre-blast posts) stay off. */
function fortw_importing() {
	return ! empty( $GLOBALS['fortw_importing'] );
}

/** Thrown by the image copier when a step's time is up; the step stops and the next one resumes. */
class FortW_Import_Paused extends Exception {}

/**
 * Runs a whole import at once (the CLI). $data: the decoded export. $opts: dry_run (bool),
 * update_existing (bool), uploads_base (URL). Returns a report: counts per kind plus warnings.
 */
function fortw_import( $data, $opts = array() ) {
	$job = fortw_import_start( $data, $opts );
	while ( ! fortw_import_run( $job ) ) { // phpcs:ignore Generic.CodeAnalysis.EmptyStatement
	}
	return $job['report'];
}

/** A new import job for fortw_import_run(); a file that isn't an export gives a finished job with a warning. */
function fortw_import_start( $data, $opts = array() ) {
	$opts = wp_parse_args( $opts, array( 'dry_run' => false, 'update_existing' => false, 'uploads_base' => 'https://submit.f3thefort.com' ) );
	$job  = array(
		'opts'         => array(
			'dry_run'         => (bool) $opts['dry_run'],
			'update_existing' => (bool) $opts['update_existing'],
			'uploads_base'    => (string) $opts['uploads_base'],
		),
		'data'         => $data,
		'phase'        => 'tags',
		'next'         => 0,
		'first_import' => ! get_option( 'fort_weekly_region' ),
		'images'       => array(), // Source URL => attachment id, for images settled during this job.
		'report'       => array(
			'events_created' => 0, 'events_updated' => 0, 'events_skipped' => 0, 'tags_created' => 0, 'tags_updated' => 0,
			'images_copied' => 0, 'images_reused' => 0, 'region' => false, 'warnings' => array(),
		),
	);
	if ( ! is_array( $data ) || ( $data['format'] ?? '' ) !== 'fort-weekly-export' || (int) ( $data['version'] ?? 0 ) !== 1 ) {
		$job['report']['warnings'][] = __( 'This is not a Fort Weekly export (version 1).', 'fort-weekly' );
		$job['phase']                = 'done';
		$job['data']                 = null;
	}
	return $job;
}

/**
 * Works on an import job until it's finished or $seconds have passed (0: no limit), always
 * finishing at least one event or image. $checkpoint( $job ), if given, is called after each
 * event so the job can be saved: if the page dies, the next step loses at most that one event's
 * progress. Returns true once the job is done.
 */
function fortw_import_run( &$job, $seconds = 0, $checkpoint = null ) {
	if ( 'done' === $job['phase'] ) {
		return true;
	}
	$dry      = $job['opts']['dry_run'];
	$update   = $job['opts']['update_existing'];
	$deadline = ( $seconds && ! $dry ) ? microtime( true ) + $seconds : 0; // A dry run downloads nothing and is quick.
	$GLOBALS['fortw_importing'] = true;
	$images = new FortW_Image_Copier( $job['opts']['uploads_base'], $dry, $job['report'], $job['images'], $deadline );
	try {
		if ( 'tags' === $job['phase'] ) {
			fortw_import_tags( $job['data']['tags'] ?? array(), $dry, $update, $job['report'] );
			$job['phase'] = 'entries';
		}
		if ( 'entries' === $job['phase'] ) {
			$entries = array_values( (array) ( $job['data']['entries'] ?? array() ) );
			$started = $job['next'];
			while ( $job['next'] < count( $entries ) ) {
				if ( $deadline && $job['next'] > $started && microtime( true ) >= $deadline ) {
					return false;
				}
				fortw_import_entry( $entries[ $job['next'] ], $dry, $update, $images, $job['report'] );
				++$job['next'];
				if ( $checkpoint ) {
					$checkpoint( $job );
				}
			}
			$job['phase'] = ( $update || $job['first_import'] ) ? 'region' : 'done';
		}
		if ( 'region' === $job['phase'] ) {
			fortw_import_region( $job['data']['region'] ?? array(), $dry, $images, $job['report'] );
			$job['phase'] = 'done';
		}
	} catch ( FortW_Import_Paused $paused ) {
		return false;
	} finally {
		$GLOBALS['fortw_importing'] = false;
		$images->done();
	}
	$job['data'] = null; // It holds submitters' contact details: don't keep it once it's used.
	if ( ! $dry ) {
		update_option( 'fortw_next_dates_day', '', false ); // Recompute every sort key on the next read.
	}
	return true;
}

/** Of a job's entries, how many are done and how many there are, for a progress line. */
function fortw_import_progress( $job ) {
	$total = is_array( $job['data'] ) ? count( (array) ( $job['data']['entries'] ?? array() ) ) : 0;
	return array( min( $job['next'], $total ), $total );
}

function fortw_import_tags( $tags, $dry, $update, &$report ) {
	foreach ( $tags as $t ) {
		$slug = sanitize_title( $t['slug'] ?? '' );
		if ( ! $slug ) {
			continue;
		}
		$term = get_term_by( 'slug', $slug, FORTW_TAX );
		if ( $term && ! $update ) {
			continue;
		}
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

function fortw_import_entry( $e, $dry, $update, $images, &$report ) {
	$legacy = (int) ( $e['legacy_id'] ?? 0 );
	$title  = sanitize_text_field( $e['title'] ?? '' );
	if ( ! $legacy || '' === $title ) {
		$report['warnings'][] = 'Skipped an entry without an id or title.';
		return;
	}
	$existing = fortw_find_by_legacy_id( $legacy );
	if ( $existing && ! $update ) {
		$report['events_skipped']++;
		return;
	}
	// Counted once the event is written: a step that runs out of time part-way through its images
	// does the whole event again next step (the images already copied are reused).
	$counter = $existing ? 'events_updated' : 'events_created';

	$occ = array();
	try {
		$occ = fortw_normalize_occurrences( $e['occurrences'] ?? array() );
	} catch ( InvalidArgumentException $ex ) {
		$report['warnings'][] = sprintf( '%s: dates skipped (%s)', $title, $ex->getMessage() );
	}
	$hero = ! empty( $e['hero_image'] ) ? $images->attachment_for( $e['hero_image'], $title ) : 0;
	if ( $dry ) {
		$images->rewrite_html( (string) ( $e['description'] ?? '' ) ); // Counts the images it would copy.
		$report[ $counter ]++;
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
		'meta_input'    => array( '_fort_legacy_id' => $legacy ), // With the post, so a re-run never makes it twice.
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
		'_fort_preblast_content'   => wp_kses_post( (string) ( $e['preblast_content'] ?? '' ) ),
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
	$report[ $counter ]++;
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
	private $seen;
	private $deadline;
	private $worked  = false; // Whether this step has already copied an image or made its sizes.
	private $tagging = '';    // The source URL being copied, while WordPress creates its attachment.

	/**
	 * $seen: source URL => attachment id for images already settled in this import (kept between
	 * steps). $deadline: when to stop starting slow work (microtime; 0 = never).
	 */
	public function __construct( $uploads_base, $dry, &$report, &$seen = array(), $deadline = 0 ) {
		$this->base     = untrailingslashit( (string) $uploads_base );
		$this->dry      = $dry;
		$this->report   = &$report;
		$this->seen     = &$seen;
		$this->deadline = $deadline;
		// The app may be on a private address or an unusual port (e.g. the local stack); allow that
		// one host for the import's downloads only.
		add_filter( 'http_request_host_is_external', array( $this, 'allow_source_host' ), 10, 2 );
		add_filter( 'http_allowed_safe_ports', array( $this, 'allow_source_port' ) );
		add_action( 'add_attachment', array( $this, 'tag_new_attachment' ) );
	}

	public function done() {
		remove_filter( 'http_request_host_is_external', array( $this, 'allow_source_host' ), 10 );
		remove_filter( 'http_allowed_safe_ports', array( $this, 'allow_source_port' ) );
		remove_action( 'add_attachment', array( $this, 'tag_new_attachment' ) );
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

	/**
	 * Tags the attachment being copied with its source URL the moment WordPress creates it, before
	 * the slow part (making its smaller sizes). If the page dies during that, the next step finds
	 * the image instead of downloading it again. Attachments other plugins add alongside (such as
	 * a WebP copy) have a different file type and are left alone.
	 */
	public function tag_new_attachment( $id ) {
		if ( '' === $this->tagging ) {
			return;
		}
		$ext  = function ( $path ) {
			return str_replace( 'jpeg', 'jpg', strtolower( pathinfo( (string) $path, PATHINFO_EXTENSION ) ) );
		};
		if ( $ext( get_attached_file( $id ) ) === $ext( wp_parse_url( $this->tagging, PHP_URL_PATH ) ) ) {
			update_post_meta( $id, '_fort_source_url', $this->tagging );
			$this->tagging = '';
		}
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

	/**
	 * Before slow work: stops the step if its time is up and it has already done some (so every
	 * step makes progress), and gives this piece of work a fresh PHP time limit.
	 */
	private function slow_work() {
		if ( $this->deadline && $this->worked && microtime( true ) >= $this->deadline ) {
			throw new FortW_Import_Paused();
		}
		$this->worked = true;
		if ( function_exists( 'set_time_limit' ) ) {
			@set_time_limit( 300 ); // phpcs:ignore WordPress.PHP.NoSilencedErrors -- some hosts forbid it; then their limit stands.
		}
		require_once ABSPATH . 'wp-admin/includes/media.php';
		require_once ABSPATH . 'wp-admin/includes/file.php';
		require_once ABSPATH . 'wp-admin/includes/image.php';
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
			$id = (int) $existing[0];
			if ( ! $this->dry ) {
				$this->finish_sizes( $id );
			}
			$this->report['images_reused']++;
			return $this->seen[ $url ] = $id;
		}
		if ( $this->dry ) {
			$this->report['images_copied']++;
			return $this->seen[ $url ] = 0;
		}
		$this->slow_work();
		$this->tagging = $url;
		try {
			$id = media_sideload_image( $url, 0, $title, 'id' );
		} finally {
			$this->tagging = '';
		}
		if ( is_wp_error( $id ) ) {
			$this->report['warnings'][] = sprintf( 'Image %s: %s', $url, $id->get_error_message() );
			return $this->seen[ $url ] = 0;
		}
		update_post_meta( $id, '_fort_source_url', $url );
		$this->report['images_copied']++;
		return $this->seen[ $url ] = (int) $id;
	}

	/**
	 * Makes the smaller sizes an image is missing: a copy whose page died part-way through. Tried
	 * twice at most; after that the image is used as it is (WordPress falls back to the full size).
	 */
	private function finish_sizes( $id ) {
		require_once ABSPATH . 'wp-admin/includes/image.php';
		$tries = (int) get_post_meta( $id, '_fort_size_tries', true );
		if ( $tries >= 2 || ! wp_get_missing_image_subsizes( $id ) ) {
			return;
		}
		$this->slow_work();
		update_post_meta( $id, '_fort_size_tries', $tries + 1 );
		wp_update_image_subsizes( $id );
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
	 * [--update-existing]
	 * : Overwrite events (and region info) imported before with the file's copy. Undoes changes
	 * made in WordPress since.
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
					'dry_run'         => isset( $assoc['dry-run'] ),
					'update_existing' => isset( $assoc['update-existing'] ),
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
