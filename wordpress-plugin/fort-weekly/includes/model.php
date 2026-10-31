<?php
/**
 * The data model: the "Event" post type, its approval statuses, private meta, the event tags
 * taxonomy, and the Fort editor role.
 *
 * Statuses: pending (needs approval) → publish (approved). Rejected and archived events get
 * their own statuses instead of the trash, which WordPress empties after 30 days.
 *
 * @package FortWeekly
 */

defined( 'ABSPATH' ) || exit;

const FORTW_POST_TYPE = 'fort_event';
const FORTW_TAX       = 'fort_tag';

/** Meta keys and their types. Every key is private (leading underscore) and never in REST. */
function fortw_meta_keys() {
	return array(
		'_fort_occurrences'       => 'array',   // [{date, start_time, end_time}], normalized and sorted.
		'_fort_next_date'         => 'string',  // Derived sort key; see fortw_next_date_key().
		'_fort_last_date'         => 'string',  // The last date ('' if none): sorts the Past view.
		'_fort_status_before_archive' => 'string', // Restoring an archived event puts it back here.
		'_fort_leader'            => 'string',  // The Q.
		'_fort_location'          => 'string',
		'_fort_link'              => 'string',  // Sign-up / details link (http(s) only).
		'_fort_video_url'         => 'string',
		'_fort_summary'           => 'string',  // Short newsletter write-up.
		'_fort_featured'          => 'boolean', // At most one event at a time.
		'_fort_hold'              => 'boolean', // On the site, but not in the newsletter.
		'_fort_callout'           => 'boolean', // "Don't miss": called out until it reaches This week.
		'_fort_preblast_requested' => 'boolean',
		'_fort_preblast_post_id'  => 'integer',
		'_fort_preblast_url'      => 'string',  // From the old app, for imported events.
		'_fort_preblast_content'  => 'string',  // Pre-blast text, if different from the description.
		'_fort_approved_at'       => 'string',  // UTC, 'Y-m-d H:i:s'.
		'_fort_reject_reason'     => 'string',
		'_fort_origin'            => 'string',  // form / admin / import / recurring.
		'_fort_legacy_id'         => 'integer', // The old app's submission id (imports match on it).
		'_fort_submitter_name'    => 'string',  // Private: shown to editors only.
		'_fort_submitter_email'   => 'string',
		'_fort_submitter_phone'   => 'string',
		'_fort_edit_token'        => 'string',  // The submitter's private edit link (editors only).
		'_fort_change_of'         => 'integer', // On a proposed change: the live event it changes.
		'_fort_live_email_sent'   => 'string',  // When "your event is live" went to the submitter.
	);
}

/** The capabilities the Fort editor role and administrators get. */
function fortw_caps() {
	return array(
		'edit_fort_events',
		'edit_others_fort_events',
		'edit_published_fort_events',
		'edit_private_fort_events',
		'publish_fort_events',
		'read_private_fort_events',
		'delete_fort_events',
		'delete_others_fort_events',
		'delete_published_fort_events',
		'delete_private_fort_events',
		'manage_fort_tags',
		'manage_fort_region',
		'manage_fort_newsletter',
	);
}

function fortw_install_roles() {
	// Fort editors run events, tags, region info and the newsletter; nothing else on the site.
	// They archive events rather than delete them (only administrators can delete).
	$editor_caps = array_filter( fortw_caps(), function ( $cap ) { return 0 !== strpos( $cap, 'delete_' ); } );
	remove_role( 'fort_editor' );
	add_role( 'fort_editor', __( 'Fort editor', 'fort-weekly' ), array_fill_keys( array_merge( array( 'read', 'upload_files' ), $editor_caps ), true ) );
	$admin = get_role( 'administrator' );
	if ( $admin ) {
		foreach ( fortw_caps() as $cap ) {
			$admin->add_cap( $cap );
		}
	}
	update_option( 'fortw_roles_version', FORT_WEEKLY_VERSION );
}

function fortw_register_model() {
	register_post_type(
		FORTW_POST_TYPE,
		array(
			'labels'          => array(
				'name'               => __( 'Events', 'fort-weekly' ),
				'singular_name'      => __( 'Event', 'fort-weekly' ),
				'add_new_item'       => __( 'Add event', 'fort-weekly' ),
				'edit_item'          => __( 'Edit event', 'fort-weekly' ),
				'search_items'       => __( 'Search events', 'fort-weekly' ),
				'not_found'          => __( 'No events found', 'fort-weekly' ),
				'not_found_in_trash' => __( 'No events in the trash', 'fort-weekly' ),
				'menu_name'          => __( 'Fort Weekly', 'fort-weekly' ),
				'all_items'          => __( 'Events', 'fort-weekly' ),
				'featured_image'     => __( 'Flyer or photo', 'fort-weekly' ),
				'set_featured_image' => __( 'Set flyer or photo', 'fort-weekly' ),
				'remove_featured_image' => __( 'Remove flyer or photo', 'fort-weekly' ),
				'use_featured_image' => __( 'Use as flyer', 'fort-weekly' ),
			),
			'public'          => true,
			'show_in_rest'    => false,     // Keeps submitter details and pending events off the REST API.
			'menu_icon'       => 'dashicons-calendar-alt',
			'menu_position'   => 5,
			'supports'        => array( 'title', 'editor', 'thumbnail', 'revisions' ),
			'has_archive'     => false,
			'rewrite'         => array( 'slug' => 'events', 'with_front' => false ),
			'capability_type' => array( 'fort_event', 'fort_events' ),
			'map_meta_cap'    => true,
			'taxonomies'      => array( FORTW_TAX ),
		)
	);

	register_taxonomy(
		FORTW_TAX,
		FORTW_POST_TYPE,
		array(
			'labels'            => array(
				'name'          => __( 'Event tags', 'fort-weekly' ),
				'singular_name' => __( 'Event tag', 'fort-weekly' ),
				'menu_name'     => __( 'Tags', 'fort-weekly' ),
				'add_new_item'  => __( 'Add tag', 'fort-weekly' ),
			),
			'public'            => false,
			'show_ui'           => true,
			'show_admin_column' => false, // The events list draws its own coloured tag column.
			'hierarchical'      => true,  // Checkbox picker on the edit screen.
			'show_in_rest'      => false,
			'rewrite'           => false,
			'capabilities'      => array(
				'manage_terms' => 'manage_fort_tags',
				'edit_terms'   => 'manage_fort_tags',
				'delete_terms' => 'manage_fort_tags',
				'assign_terms' => 'edit_fort_events',
			),
		)
	);

	register_post_status(
		'fort_rejected',
		array(
			'label'                     => _x( 'Rejected', 'event status', 'fort-weekly' ),
			'public'                    => false,
			'internal'                  => false,
			'protected'                 => true,
			'show_in_admin_all_list'    => false,
			'show_in_admin_status_list' => true,
			/* translators: %s: number of events */
			'label_count'               => _n_noop( 'Rejected <span class="count">(%s)</span>', 'Rejected <span class="count">(%s)</span>', 'fort-weekly' ),
		)
	);
	register_post_status(
		'fort_archived',
		array(
			'label'                     => _x( 'Archived', 'event status', 'fort-weekly' ),
			'public'                    => false,
			'internal'                  => false,
			'protected'                 => true,
			'show_in_admin_all_list'    => false,
			'show_in_admin_status_list' => true,
			/* translators: %s: number of events */
			'label_count'               => _n_noop( 'Archived <span class="count">(%s)</span>', 'Archived <span class="count">(%s)</span>', 'fort-weekly' ),
		)
	);

	$can_edit = function () {
		return current_user_can( 'edit_fort_events' );
	};
	foreach ( fortw_meta_keys() as $key => $type ) {
		register_post_meta(
			FORTW_POST_TYPE,
			$key,
			array(
				'type'          => $type,
				'single'        => true,
				'show_in_rest'  => false,
				'auth_callback' => $can_edit,
			)
		);
	}
	foreach ( array( 'fort_color', 'fort_order' ) as $key ) {
		register_term_meta( FORTW_TAX, $key, array( 'single' => true, 'show_in_rest' => false ) );
	}
}
add_action( 'init', 'fortw_register_model' );

// Events use the classic editor: the edit screen is mostly meta boxes around a description.
add_filter(
	'use_block_editor_for_post_type',
	function ( $use, $post_type ) {
		return FORTW_POST_TYPE === $post_type ? false : $use;
	},
	10,
	2
);
