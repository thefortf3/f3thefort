<?php
/**
 * The Events list in wp-admin: one row per event, sorted by next date.
 *
 * Views: Needs approval · Upcoming (the default) · Held · Past · Rejected · Archived · Everything.
 * Columns: next date (+N more), title, tags, Q, location, featured/held, flyer.
 * Filters: tag, has flyer; search also matches the Q and location.
 * Row actions: Approve / Reject (pending), Feature, Hold, Archive / Restore. Bulk: Approve.
 *
 * @package FortWeekly
 */

defined( 'ABSPATH' ) || exit;

function fortw_list_url( $args = array() ) {
	return add_query_arg( $args, admin_url( 'edit.php?post_type=' . FORTW_POST_TYPE ) );
}

/** The current list view: pending, upcoming, held, past, rejected, archived or all. */
function fortw_current_view() {
	// phpcs:disable WordPress.Security.NonceVerification.Recommended -- read-only list filters
	$status = isset( $_GET['post_status'] ) ? sanitize_key( wp_unslash( $_GET['post_status'] ) ) : '';
	$view   = isset( $_GET['fort_view'] ) ? sanitize_key( wp_unslash( $_GET['fort_view'] ) ) : '';
	// phpcs:enable
	$map = array( 'pending' => 'pending', 'fort_rejected' => 'rejected', 'fort_archived' => 'archived', 'publish' => 'upcoming', 'draft' => 'draft' );
	if ( $status ) {
		return $map[ $status ] ?? 'all';
	}
	return in_array( $view, array( 'held', 'past', 'all' ), true ) ? $view : 'upcoming';
}

// ── Menu: a count of events waiting for approval ─────────────────────────

add_action(
	'admin_menu',
	function () {
		global $menu;
		$n = fortw_pending_count();
		if ( ! $n ) {
			return;
		}
		foreach ( $menu as $i => $item ) {
			if ( 'edit.php?post_type=' . FORTW_POST_TYPE === $item[2] ) {
				/* translators: %d: number of events */
				$menu[ $i ][0] .= sprintf( ' <span class="awaiting-mod count-%1$d"><span class="pending-count" aria-label="%2$s">%1$d</span></span>', $n, esc_attr( sprintf( _n( '%d event needs approval', '%d events need approval', $n, 'fort-weekly' ), $n ) ) );
			}
		}
	},
	99
);

// ── Query: views, default sort, filters, search ─────────────────────────

add_action(
	'pre_get_posts',
	function ( $q ) {
		global $pagenow;
		if ( ! is_admin() || 'edit.php' !== $pagenow || ! $q->is_main_query() || FORTW_POST_TYPE !== $q->get( 'post_type' ) ) {
			return;
		}
		fortw_refresh_next_dates();
		$today = fortw_today();
		$meta  = array();
		$view  = fortw_current_view();

		switch ( $view ) {
			case 'upcoming':
				$q->set( 'post_status', 'publish' );
				$meta[] = array( 'key' => '_fort_next_date', 'value' => $today, 'compare' => '>=' );
				break;
			case 'held':
				$q->set( 'post_status', 'publish' );
				$meta[] = array( 'key' => '_fort_hold', 'value' => '1' );
				break;
			case 'past':
				$q->set( 'post_status', 'publish' );
				$meta[] = array( 'key' => '_fort_next_date', 'value' => '0000-00-00' );
				break;
			case 'all':
				$q->set( 'post_status', array( 'publish', 'pending', 'draft', 'fort_rejected', 'fort_archived' ) );
				break;
		}

		// phpcs:disable WordPress.Security.NonceVerification.Recommended -- read-only list filters
		$tag = isset( $_GET['fort_tag_filter'] ) ? sanitize_title( wp_unslash( $_GET['fort_tag_filter'] ) ) : '';
		if ( $tag ) {
			$q->set( 'tax_query', array( array( 'taxonomy' => FORTW_TAX, 'field' => 'slug', 'terms' => $tag ) ) );
		}
		$flyer = isset( $_GET['fort_flyer'] ) ? sanitize_key( wp_unslash( $_GET['fort_flyer'] ) ) : '';
		if ( 'yes' === $flyer || 'no' === $flyer ) {
			$meta[] = array( 'key' => '_thumbnail_id', 'compare' => 'yes' === $flyer ? 'EXISTS' : 'NOT EXISTS' );
		}
		$orderby = isset( $_GET['orderby'] ) ? sanitize_key( wp_unslash( $_GET['orderby'] ) ) : '';
		$order   = isset( $_GET['order'] ) && 'desc' === strtolower( sanitize_key( wp_unslash( $_GET['order'] ) ) ) ? 'DESC' : 'ASC';
		// phpcs:enable

		if ( ! $orderby || 'fort_next' === $orderby ) {
			if ( 'past' === $view || 'archived' === $view || 'all' === $view ) {
				// Most recent first: the last date, or the time the event was submitted.
				$meta['fort_sort'] = array( 'key' => '_fort_last_date', 'compare' => 'EXISTS' );
				$q->set( 'orderby', array( 'fort_sort' => $orderby ? $order : 'DESC', 'date' => 'DESC' ) );
			} else {
				$meta['fort_sort'] = array( 'key' => '_fort_next_date', 'compare' => 'EXISTS' );
				$q->set( 'orderby', array( 'fort_sort' => $order, 'title' => 'ASC' ) );
			}
		}
		if ( $meta ) {
			$q->set( 'meta_query', array_merge( array( 'relation' => 'AND' ), $meta ) );
		}
	}
);

// Search also matches the Q and the location.
add_filter(
	'posts_search',
	function ( $search, $q ) {
		global $wpdb, $pagenow;
		if ( ! is_admin() || 'edit.php' !== $pagenow || ! $q->is_main_query() || FORTW_POST_TYPE !== $q->get( 'post_type' ) || '' === $search ) {
			return $search;
		}
		$term = '%' . $wpdb->esc_like( (string) $q->get( 's' ) ) . '%';
		$meta = $wpdb->prepare(
			"EXISTS (SELECT 1 FROM {$wpdb->postmeta} fm WHERE fm.post_id = {$wpdb->posts}.ID AND fm.meta_key IN ('_fort_leader','_fort_location') AND fm.meta_value LIKE %s)",
			$term
		);
		// WordPress's clause is " AND ((...title/content matches...)) "; widen it with an OR.
		return preg_replace( '/^\s*AND\s*\(/', ' AND ( ' . $meta . ' OR ', $search, 1 );
	},
	10,
	2
);

add_filter(
	'views_edit-' . FORTW_POST_TYPE,
	function ( $views ) {
		$current = fortw_current_view();
		$counts  = wp_count_posts( FORTW_POST_TYPE );
		$today   = fortw_today();
		$count   = function ( $meta ) {
			return count(
				get_posts(
					array(
						'post_type'        => FORTW_POST_TYPE,
						'post_status'      => 'publish',
						'posts_per_page'   => -1,
						'fields'           => 'ids',
						'suppress_filters' => true,
						'meta_query'       => array( $meta ),
					)
				)
			);
		};
		$link = function ( $key, $label, $n, $url ) use ( $current ) {
			return sprintf(
				'<a href="%s"%s>%s <span class="count">(%s)</span></a>',
				esc_url( $url ),
				$current === $key ? ' class="current" aria-current="page"' : '',
				esc_html( $label ),
				number_format_i18n( $n )
			);
		};
		return array(
			'pending'  => $link( 'pending', __( 'Needs approval', 'fort-weekly' ), (int) ( $counts->pending ?? 0 ), fortw_list_url( array( 'post_status' => 'pending' ) ) ),
			'upcoming' => $link( 'upcoming', __( 'Upcoming', 'fort-weekly' ), $count( array( 'key' => '_fort_next_date', 'value' => $today, 'compare' => '>=' ) ), fortw_list_url() ),
			'held'     => $link( 'held', __( 'Held from newsletter', 'fort-weekly' ), $count( array( 'key' => '_fort_hold', 'value' => '1' ) ), fortw_list_url( array( 'fort_view' => 'held' ) ) ),
			'past'     => $link( 'past', __( 'Past', 'fort-weekly' ), $count( array( 'key' => '_fort_next_date', 'value' => '0000-00-00' ) ), fortw_list_url( array( 'fort_view' => 'past' ) ) ),
			'rejected' => $link( 'rejected', __( 'Rejected', 'fort-weekly' ), (int) ( $counts->fort_rejected ?? 0 ), fortw_list_url( array( 'post_status' => 'fort_rejected' ) ) ),
			'archived' => $link( 'archived', __( 'Archived', 'fort-weekly' ), (int) ( $counts->fort_archived ?? 0 ), fortw_list_url( array( 'post_status' => 'fort_archived' ) ) ),
			'all'      => $link( 'all', __( 'Everything', 'fort-weekly' ), array_sum( array_map( function ( $s ) use ( $counts ) { return (int) ( $counts->$s ?? 0 ); }, array( 'publish', 'pending', 'draft', 'fort_rejected', 'fort_archived' ) ) ), fortw_list_url( array( 'fort_view' => 'all' ) ) ),
		);
	}
);

add_action(
	'restrict_manage_posts',
	function ( $post_type ) {
		if ( FORTW_POST_TYPE !== $post_type ) {
			return;
		}
		// phpcs:disable WordPress.Security.NonceVerification.Recommended -- read-only list filters
		$tag   = isset( $_GET['fort_tag_filter'] ) ? sanitize_title( wp_unslash( $_GET['fort_tag_filter'] ) ) : '';
		$flyer = isset( $_GET['fort_flyer'] ) ? sanitize_key( wp_unslash( $_GET['fort_flyer'] ) ) : '';
		$view  = isset( $_GET['fort_view'] ) ? sanitize_key( wp_unslash( $_GET['fort_view'] ) ) : '';
		// phpcs:enable
		if ( $view ) {
			echo '<input type="hidden" name="fort_view" value="' . esc_attr( $view ) . '">';
		}
		echo '<select name="fort_tag_filter"><option value="">' . esc_html__( 'All tags', 'fort-weekly' ) . '</option>';
		foreach ( fortw_all_tags() as $t ) {
			printf( '<option value="%s"%s>%s</option>', esc_attr( $t['slug'] ), selected( $tag, $t['slug'], false ), esc_html( $t['label'] ) );
		}
		echo '</select>';
		echo '<select name="fort_flyer"><option value="">' . esc_html__( 'Flyer: any', 'fort-weekly' ) . '</option>';
		printf( '<option value="yes"%s>%s</option>', selected( $flyer, 'yes', false ), esc_html__( 'Has a flyer', 'fort-weekly' ) );
		printf( '<option value="no"%s>%s</option>', selected( $flyer, 'no', false ), esc_html__( 'No flyer', 'fort-weekly' ) );
		echo '</select>';
	}
);

// ── Columns ─────────────────────────────────────────────────────────────

add_filter(
	'manage_' . FORTW_POST_TYPE . '_posts_columns',
	function () {
		return array(
			'cb'            => '<input type="checkbox">',
			'fort_next'     => __( 'Next date', 'fort-weekly' ),
			'title'         => __( 'Event', 'fort-weekly' ),
			'fort_tags'     => __( 'Tags', 'fort-weekly' ),
			'fort_q'        => __( 'Q', 'fort-weekly' ),
			'fort_location' => __( 'Where', 'fort-weekly' ),
			'fort_flags'    => __( 'Newsletter', 'fort-weekly' ),
			'fort_flyer'    => __( 'Flyer', 'fort-weekly' ),
		) + ( 'pending' === fortw_current_view() ? array( 'fort_from' => __( 'Submitted by', 'fort-weekly' ) ) : array() );
	}
);

add_filter(
	'manage_edit-' . FORTW_POST_TYPE . '_sortable_columns',
	function () {
		return array( 'fort_next' => 'fort_next', 'title' => 'title' );
	}
);

add_action(
	'manage_' . FORTW_POST_TYPE . '_posts_custom_column',
	function ( $column, $post_id ) {
		static $cache = array();
		if ( ! isset( $cache[ $post_id ] ) ) {
			$cache[ $post_id ] = fortw_entry( $post_id );
		}
		$e = $cache[ $post_id ];
		switch ( $column ) {
			case 'fort_next':
				if ( $e['next_occurrence'] ) {
					$p    = fortw_date_parts( $e['next_occurrence']['date'] );
					$more = count( fortw_upcoming_dates( $e['occurrences'], fortw_today() ) ) - 1;
					printf( '<span class="fortw-date"><b>%s %s %d</b>%s</span>', esc_html( $p['dow'] ), esc_html( $p['mon'] ), (int) $p['day'], $e['next_occurrence']['start_time'] ? ' <span class="fortw-time">' . esc_html( $e['next_occurrence']['start_time'] ) . '</span>' : '' );
					if ( $more > 0 ) {
						/* translators: %d: number of later dates */
						printf( '<br><span class="fortw-dim">%s</span>', esc_html( sprintf( _n( '+%d more date', '+%d more dates', $more, 'fort-weekly' ), $more ) ) );
					}
				} elseif ( $e['occurrences'] ) {
					$last = fortw_date_parts( end( $e['occurrences'] )['date'] );
					/* translators: 1: month, 2: day */
					printf( '<span class="fortw-dim">%s</span>', esc_html( sprintf( __( 'Past · %1$s %2$d', 'fort-weekly' ), $last['mon'], $last['day'] ) ) );
				} else {
					echo '<span class="fortw-dim">' . esc_html__( 'Ongoing', 'fort-weekly' ) . '</span>';
				}
				break;
			case 'fort_tags':
				foreach ( $e['tags'] as $t ) {
					printf( '<span class="fortw-tag" style="--c:%s">%s</span> ', esc_attr( $t['color'] ), esc_html( $t['label'] ) );
				}
				break;
			case 'fort_q':
				echo esc_html( (string) $e['leader'] );
				break;
			case 'fort_location':
				echo esc_html( (string) $e['location'] );
				break;
			case 'fort_flags':
				if ( $e['featured'] ) {
					echo '<span class="fortw-flag fortw-flag--featured">★ ' . esc_html__( 'Featured', 'fort-weekly' ) . '</span> ';
				}
				if ( $e['hold_from_newsletter'] ) {
					echo '<span class="fortw-flag fortw-flag--held">' . esc_html__( 'Held', 'fort-weekly' ) . '</span>';
				}
				break;
			case 'fort_from':
				$who = fortw_entry_private( $post_id );
				echo esc_html( (string) $who['name'] );
				if ( $who['email'] ) {
					printf( '<br><a href="mailto:%1$s">%2$s</a>', esc_attr( $who['email'] ), esc_html( $who['email'] ) );
				}
				if ( $who['phone'] ) {
					echo '<br>' . esc_html( $who['phone'] );
				}
				echo '<br><span class="fortw-dim">' . esc_html( get_the_date( 'M j, g:ia', $post_id ) ) . '</span>';
				break;
			case 'fort_flyer':
				$thumb = get_the_post_thumbnail( $post_id, array( 48, 64 ), array( 'class' => 'fortw-thumb', 'loading' => 'lazy' ) );
				echo $thumb ? $thumb : '<span class="fortw-dim">—</span>'; // phpcs:ignore WordPress.Security.EscapeOutput -- core markup
				break;
		}
	},
	10,
	2
);

add_filter(
	'display_post_states',
	function ( $states, $post ) {
		if ( FORTW_POST_TYPE !== $post->post_type ) {
			return $states;
		}
		unset( $states['pending'] );
		if ( 'pending' === $post->post_status ) {
			$states['fortw'] = __( 'Needs approval', 'fort-weekly' );
		} elseif ( 'fort_rejected' === $post->post_status ) {
			$states['fortw'] = __( 'Rejected', 'fort-weekly' );
		} elseif ( 'fort_archived' === $post->post_status ) {
			$states['fortw'] = __( 'Archived', 'fort-weekly' );
		}
		return $states;
	},
	10,
	2
);

// ── Row and bulk actions ────────────────────────────────────────────────

function fortw_action_url( $do, $post_id ) {
	return wp_nonce_url( admin_url( 'admin-post.php?action=fortw_row&do=' . $do . '&post=' . (int) $post_id ), 'fortw_row_' . $do . '_' . (int) $post_id );
}

add_filter(
	'post_row_actions',
	function ( $actions, $post ) {
		if ( FORTW_POST_TYPE !== $post->post_type || ! current_user_can( 'edit_post', $post->ID ) ) {
			return $actions;
		}
		unset( $actions['trash'], $actions['inline hide-if-no-js'] ); // Archive instead; the trash empties itself.
		$out    = array();
		$status = $post->post_status;
		if ( 'pending' === $status || 'draft' === $status || 'fort_rejected' === $status ) {
			if ( current_user_can( 'publish_fort_events' ) ) {
				$out['fortw_approve'] = sprintf( '<a href="%s" class="fortw-approve">%s</a>', esc_url( fortw_action_url( 'approve', $post->ID ) ), esc_html__( 'Approve', 'fort-weekly' ) );
			}
		}
		if ( 'pending' === $status || 'publish' === $status ) {
			$out['fortw_reject'] = sprintf( '<a href="%s" class="fortw-reject">%s</a>', esc_url( admin_url( 'admin.php?page=fortw-reject&post=' . $post->ID ) ), esc_html__( 'Reject…', 'fort-weekly' ) );
		}
		if ( 'publish' === $status ) {
			$featured             = (bool) get_post_meta( $post->ID, '_fort_featured', true );
			$held                 = (bool) get_post_meta( $post->ID, '_fort_hold', true );
			$out['fortw_feature'] = sprintf( '<a href="%s">%s</a>', esc_url( fortw_action_url( $featured ? 'unfeature' : 'feature', $post->ID ) ), $featured ? esc_html__( 'Unfeature', 'fort-weekly' ) : esc_html__( 'Feature', 'fort-weekly' ) );
			$out['fortw_hold']    = sprintf( '<a href="%s">%s</a>', esc_url( fortw_action_url( $held ? 'unhold' : 'hold', $post->ID ) ), $held ? esc_html__( 'Put back in newsletter', 'fort-weekly' ) : esc_html__( 'Hold from newsletter', 'fort-weekly' ) );
		}
		if ( 'fort_archived' === $status ) {
			$out['fortw_restore'] = sprintf( '<a href="%s">%s</a>', esc_url( fortw_action_url( 'restore', $post->ID ) ), esc_html__( 'Restore', 'fort-weekly' ) );
		} else {
			$out['fortw_archive'] = sprintf( '<a href="%s">%s</a>', esc_url( fortw_action_url( 'archive', $post->ID ) ), esc_html__( 'Archive', 'fort-weekly' ) );
		}
		return array_merge( $out, $actions );
	},
	10,
	2
);

add_action(
	'admin_post_fortw_row',
	function () {
		$do      = isset( $_GET['do'] ) ? sanitize_key( wp_unslash( $_GET['do'] ) ) : '';
		$post_id = isset( $_GET['post'] ) ? (int) $_GET['post'] : 0;
		check_admin_referer( 'fortw_row_' . $do . '_' . $post_id );
		$post = get_post( $post_id );
		if ( ! $post || FORTW_POST_TYPE !== $post->post_type || ! current_user_can( 'edit_post', $post_id ) ) {
			wp_die( esc_html__( 'Sorry, you are not allowed to do that.', 'fort-weekly' ), 403 );
		}
		switch ( $do ) {
			case 'approve':
				if ( ! current_user_can( 'publish_fort_events' ) ) {
					wp_die( esc_html__( 'Sorry, you are not allowed to approve events.', 'fort-weekly' ), 403 );
				}
				fortw_approve( $post_id );
				break;
			case 'feature':
			case 'unfeature':
				fortw_set_featured( $post_id, 'feature' === $do );
				fortw_clear_page_cache();
				break;
			case 'hold':
			case 'unhold':
				fortw_set_hold( $post_id, 'hold' === $do );
				break;
			case 'archive':
				fortw_archive( $post_id );
				break;
			case 'restore':
				fortw_restore( $post_id );
				break;
			default:
				wp_die( esc_html__( 'Unknown action.', 'fort-weekly' ), 400 );
		}
		$back = wp_get_referer();
		wp_safe_redirect( add_query_arg( array( 'fortw_done' => $do, 'fortw_post' => $post_id ), $back ? $back : fortw_list_url() ) );
		exit;
	}
);

add_filter(
	'bulk_actions-edit-' . FORTW_POST_TYPE,
	function ( $actions ) {
		unset( $actions['trash'], $actions['edit'] );
		if ( current_user_can( 'publish_fort_events' ) ) {
			$actions = array( 'fortw_approve' => __( 'Approve', 'fort-weekly' ) ) + $actions;
		}
		$actions['fortw_archive'] = __( 'Archive', 'fort-weekly' );
		return $actions;
	}
);

add_filter(
	'handle_bulk_actions-edit-' . FORTW_POST_TYPE,
	function ( $redirect, $action, $ids ) {
		if ( ! in_array( $action, array( 'fortw_approve', 'fortw_archive' ), true ) ) {
			return $redirect;
		}
		$done = 0;
		foreach ( $ids as $id ) {
			if ( ! current_user_can( 'edit_post', $id ) ) {
				continue;
			}
			if ( 'fortw_approve' === $action && current_user_can( 'publish_fort_events' ) ) {
				$done += is_wp_error( fortw_approve( $id ) ) ? 0 : 1;
			} elseif ( 'fortw_archive' === $action ) {
				$done += is_wp_error( fortw_archive( $id ) ) ? 0 : 1;
			}
		}
		return add_query_arg( array( 'fortw_done' => 'fortw_approve' === $action ? 'bulk_approve' : 'bulk_archive', 'fortw_n' => $done ), $redirect );
	},
	10,
	3
);

add_action(
	'admin_notices',
	function () {
		$screen = get_current_screen();
		if ( ! $screen || 'edit-' . FORTW_POST_TYPE !== $screen->id || empty( $_GET['fortw_done'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended
			return;
		}
		$do    = sanitize_key( wp_unslash( $_GET['fortw_done'] ) ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$n     = isset( $_GET['fortw_n'] ) ? (int) $_GET['fortw_n'] : 1; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$title = isset( $_GET['fortw_post'] ) ? get_the_title( (int) $_GET['fortw_post'] ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$messages = array(
			/* translators: %s: event title */
			'approve'      => sprintf( __( 'Approved “%s”. It is on the site now and goes in the next newsletter.', 'fort-weekly' ), $title ),
			/* translators: %s: event title */
			'reject'       => sprintf( __( 'Rejected “%s”.', 'fort-weekly' ), $title ),
			/* translators: %s: event title */
			'feature'      => sprintf( __( '“%s” is now the featured event.', 'fort-weekly' ), $title ),
			/* translators: %s: event title */
			'unfeature'    => sprintf( __( '“%s” is no longer featured.', 'fort-weekly' ), $title ),
			/* translators: %s: event title */
			'hold'         => sprintf( __( '“%s” stays on the site but is held out of the newsletter.', 'fort-weekly' ), $title ),
			/* translators: %s: event title */
			'unhold'       => sprintf( __( '“%s” is back in the newsletter.', 'fort-weekly' ), $title ),
			/* translators: %s: event title */
			'archive'      => sprintf( __( 'Archived “%s”.', 'fort-weekly' ), $title ),
			/* translators: %s: event title */
			'restore'      => sprintf( __( 'Restored “%s”.', 'fort-weekly' ), $title ),
			/* translators: %d: number of events */
			'bulk_approve' => sprintf( _n( 'Approved %d event.', 'Approved %d events.', $n, 'fort-weekly' ), $n ),
			/* translators: %d: number of events */
			'bulk_archive' => sprintf( _n( 'Archived %d event.', 'Archived %d events.', $n, 'fort-weekly' ), $n ),
		);
		if ( isset( $messages[ $do ] ) ) {
			echo '<div class="notice notice-success is-dismissible"><p>' . esc_html( $messages[ $do ] ) . '</p></div>';
		}
	}
);

// ── Reject: a small screen for the reason ───────────────────────────────

add_action(
	'admin_menu',
	function () {
		add_submenu_page( '', __( 'Reject event', 'fort-weekly' ), '', 'edit_fort_events', 'fortw-reject', 'fortw_render_reject_page' );
	}
);

function fortw_render_reject_page() {
	$post_id = isset( $_GET['post'] ) ? (int) $_GET['post'] : 0; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
	$post    = get_post( $post_id );
	if ( ! $post || FORTW_POST_TYPE !== $post->post_type || ! current_user_can( 'edit_post', $post_id ) ) {
		wp_die( esc_html__( 'Sorry, you are not allowed to do that.', 'fort-weekly' ), 403 );
	}
	?>
	<div class="wrap">
		<?php /* translators: %s: event title */ ?>
		<h1><?php echo esc_html( sprintf( __( 'Reject “%s”', 'fort-weekly' ), $post->post_title ) ); ?></h1>
		<p><?php esc_html_e( 'It comes off the site and out of the newsletter. You can approve it again later from the Rejected list.', 'fort-weekly' ); ?></p>
		<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
			<input type="hidden" name="action" value="fortw_reject">
			<input type="hidden" name="post" value="<?php echo (int) $post_id; ?>">
			<?php wp_nonce_field( 'fortw_reject_' . $post_id ); ?>
			<p><label for="fortw-reason"><?php esc_html_e( 'Reason (for the other editors; not sent to anyone)', 'fort-weekly' ); ?></label><br>
				<textarea id="fortw-reason" name="reason" rows="3" class="large-text" maxlength="500"></textarea></p>
			<?php submit_button( __( 'Reject', 'fort-weekly' ), 'primary', 'submit', false ); ?>
			<a class="button" href="<?php echo esc_url( fortw_list_url( array( 'post_status' => 'pending' ) ) ); ?>"><?php esc_html_e( 'Cancel', 'fort-weekly' ); ?></a>
		</form>
	</div>
	<?php
}

add_action(
	'admin_post_fortw_reject',
	function () {
		$post_id = isset( $_POST['post'] ) ? (int) $_POST['post'] : 0;
		check_admin_referer( 'fortw_reject_' . $post_id );
		$post = get_post( $post_id );
		if ( ! $post || FORTW_POST_TYPE !== $post->post_type || ! current_user_can( 'edit_post', $post_id ) ) {
			wp_die( esc_html__( 'Sorry, you are not allowed to do that.', 'fort-weekly' ), 403 );
		}
		fortw_reject( $post_id, wp_unslash( $_POST['reason'] ?? '' ) ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput -- sanitized in fortw_reject
		wp_safe_redirect( fortw_list_url( array( 'post_status' => 'pending', 'fortw_done' => 'reject', 'fortw_post' => $post_id ) ) );
		exit;
	}
);
