<?php
/**
 * Fort Weekly → Desk of the Nan'tan, Shovel flags & VQs, and Region: what the site and newsletter
 * show besides events. Three pages over one option, fort_weekly_region (see
 * fortw_region_defaults()); each page saves only its own fields.
 *
 * @package FortWeekly
 */

defined( 'ABSPATH' ) || exit;

/**
 * The pages: slug => [menu title, page title, what's on it]. 'nantan' is the note, 'fng_goal' the
 * FNG goal; the rest are keys of fortw_region_lists().
 */
function fortw_region_pages() {
	return array(
		'fortw-nantan' => array( __( 'Desk of the Nan’tan', 'fort-weekly' ), __( 'Desk of the Nan’tan', 'fort-weekly' ), array( 'nantan' ) ),
		'fortw-week'   => array( __( 'Shovel flags & VQs', 'fort-weekly' ), __( 'Shovel flags & VQs', 'fort-weekly' ), array( 'shovel_flags', 'vqs' ) ),
		'fortw-region' => array( __( 'Region', 'fort-weekly' ), __( 'Region info', 'fort-weekly' ), array( 'three_fs', 'slt', 'links', 'fng_goal' ) ),
	);
}

add_action(
	'admin_menu',
	function () {
		foreach ( fortw_region_pages() as $slug => $page ) {
			add_submenu_page( 'edit.php?post_type=' . FORTW_POST_TYPE, $page[1], $page[0], 'manage_fort_region', $slug, 'fortw_render_region_page' );
		}
	},
	20
);

/** The editable lists: key => [title, help, columns => [label, kind]]. */
function fortw_region_lists() {
	return array(
		'three_fs'     => array(
			__( 'Every week (Three F’s)', 'fort-weekly' ),
			__( 'Regular fellowship and faith events, and calendar links. Shown as “Every week” on the site and in the newsletter.', 'fort-weekly' ),
			array(
				'column' => array( __( 'Column', 'fort-weekly' ), array( 'fitness' => __( 'Fitness', 'fort-weekly' ), 'fellowship' => __( 'Fellowship', 'fort-weekly' ), 'faith' => __( 'Faith', 'fort-weekly' ) ) ),
				'type'   => array( __( 'Kind', 'fort-weekly' ), array( 'event' => __( 'Event', 'fort-weekly' ), 'link' => __( 'Link', 'fort-weekly' ) ) ),
				'name'   => array( __( 'Event name', 'fort-weekly' ), 'text' ),
				'detail' => array( __( 'When · where', 'fort-weekly' ), 'text' ),
				'label'  => array( __( 'Link text', 'fort-weekly' ), 'text' ),
				'url'    => array( __( 'Link', 'fort-weekly' ), 'url' ),
			),
		),
		'slt'          => array( __( 'Shared leadership (SLT)', 'fort-weekly' ), '', array( 'role' => array( __( 'Role', 'fort-weekly' ), 'text' ), 'name' => array( __( 'Name', 'fort-weekly' ), 'text' ) ) ),
		'links'        => array( __( 'Helpful links', 'fort-weekly' ), '', array( 'label' => array( __( 'Button text', 'fort-weekly' ), 'text' ), 'name' => array( __( 'Description', 'fort-weekly' ), 'text' ), 'url' => array( __( 'Link', 'fort-weekly' ), 'url' ) ) ),
		'shovel_flags' => array( __( 'Shovel flags', 'fort-weekly' ), '', array( 'from' => array( __( 'From', 'fort-weekly' ), 'text' ), 'to' => array( __( 'To', 'fort-weekly' ), 'text' ), 'ao' => array( __( 'AO', 'fort-weekly' ), 'text' ) ) ),
		'vqs'          => array( __( 'VQs this week', 'fort-weekly' ), '', array( 'name' => array( __( 'Name', 'fort-weekly' ), 'text' ), 'ao' => array( __( 'AO', 'fort-weekly' ), 'text' ) ) ),
	);
}

function fortw_region_cell( $list, $index, $field, $spec, $value ) {
	$name = sprintf( 'region[%s][%s][%s]', $list, $index, $field );
	if ( is_array( $spec[1] ) ) {
		$out = '<select name="' . esc_attr( $name ) . '" aria-label="' . esc_attr( $spec[0] ) . '">';
		foreach ( $spec[1] as $k => $label ) {
			$out .= '<option value="' . esc_attr( $k ) . '"' . selected( $value, $k, false ) . '>' . esc_html( $label ) . '</option>';
		}
		return $out . '</select>';
	}
	return sprintf( '<input type="%s" name="%s" value="%s" aria-label="%s"%s>', 'url' === $spec[1] ? 'url' : 'text', esc_attr( $name ), esc_attr( (string) $value ), esc_attr( $spec[0] ), 'url' === $spec[1] ? ' placeholder="https://…"' : '' );
}

function fortw_region_row( $list, $index, $columns, $row ) {
	$cells = '';
	foreach ( $columns as $field => $spec ) {
		$cells .= '<td>' . fortw_region_cell( $list, $index, $field, $spec, $row[ $field ] ?? '' ) . '</td>';
	}
	return '<tr>' . $cells . '<td class="fortw-row-tools">'
		. '<button type="button" class="button-link fortw-up" aria-label="' . esc_attr__( 'Move up', 'fort-weekly' ) . '">↑</button> '
		. '<button type="button" class="button-link fortw-down" aria-label="' . esc_attr__( 'Move down', 'fort-weekly' ) . '">↓</button> '
		. '<button type="button" class="button-link fortw-remove-row" aria-label="' . esc_attr__( 'Remove', 'fort-weekly' ) . '">✕</button></td></tr>';
}

function fortw_render_region_page() {
	if ( ! current_user_can( 'manage_fort_region' ) ) {
		wp_die( esc_html__( 'Sorry, you are not allowed to do that.', 'fort-weekly' ) );
	}
	$pages = fortw_region_pages();
	$slug  = isset( $_GET['page'] ) && isset( $pages[ $_GET['page'] ] ) ? sanitize_key( $_GET['page'] ) : 'fortw-region'; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
	$parts = $pages[ $slug ][2];
	$s     = fortw_region_settings();
	?>
	<div class="wrap fortw-region">
		<h1><?php echo esc_html( $pages[ $slug ][1] ); ?></h1>
		<?php if ( isset( $_GET['saved'] ) ) : // phpcs:ignore WordPress.Security.NonceVerification.Recommended ?>
			<div class="notice notice-success is-dismissible"><p><?php esc_html_e( 'Saved. The site shows it now; the newsletter picks it up next time it’s generated.', 'fort-weekly' ); ?></p></div>
		<?php endif; ?>
		<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
			<input type="hidden" name="action" value="fortw_region">
			<input type="hidden" name="fortw_page" value="<?php echo esc_attr( $slug ); ?>">
			<?php wp_nonce_field( 'fortw_region' ); ?>

			<?php
			if ( in_array( 'nantan', $parts, true ) ) :
				$n     = $s['nantan'];
				$image = $n['image_id'] ? wp_get_attachment_image_url( (int) $n['image_id'], 'medium' ) : '';
				?>
				<p class="description"><?php esc_html_e( 'The note at the top of the newsletter.', 'fort-weekly' ); ?></p>
				<table class="form-table" role="presentation">
					<tr><th scope="row"><label for="fortw-n-heading"><?php esc_html_e( 'Heading', 'fort-weekly' ); ?></label></th>
						<td><input type="text" id="fortw-n-heading" name="region[nantan][heading]" value="<?php echo esc_attr( $n['heading'] ); ?>" class="regular-text"></td></tr>
					<tr><th scope="row"><label for="fortw-n-author"><?php esc_html_e( 'From', 'fort-weekly' ); ?></label></th>
						<td><input type="text" id="fortw-n-author" name="region[nantan][author]" value="<?php echo esc_attr( $n['author'] ); ?>" class="regular-text" placeholder="Band Camp"></td></tr>
					<tr><th scope="row"><?php esc_html_e( 'Note', 'fort-weekly' ); ?></th>
						<td><?php wp_editor( $n['text'], 'fortw_nantan_text', array( 'textarea_name' => 'region[nantan][text]', 'textarea_rows' => 6, 'media_buttons' => false, 'teeny' => true ) ); ?></td></tr>
					<tr><th scope="row"><?php esc_html_e( 'Image (optional)', 'fort-weekly' ); ?></th>
						<td class="fortw-image-pick">
							<input type="hidden" name="region[nantan][image_id]" value="<?php echo (int) $n['image_id']; ?>">
							<img src="<?php echo esc_url( $image ); ?>" alt="" class="fortw-image-preview"<?php echo $image ? '' : ' hidden'; ?>>
							<button type="button" class="button fortw-image-choose"><?php esc_html_e( 'Choose image', 'fort-weekly' ); ?></button>
							<button type="button" class="button-link fortw-image-clear"<?php echo $image ? '' : ' hidden'; ?>><?php esc_html_e( 'Remove', 'fort-weekly' ); ?></button>
						</td></tr>
				</table>
			<?php endif; ?>

			<?php
			foreach ( fortw_region_lists() as $key => $list ) :
				if ( ! in_array( $key, $parts, true ) ) {
					continue;
				}
				?>
				<h2><?php echo esc_html( $list[0] ); ?></h2>
				<?php if ( $list[1] ) : ?><p class="description"><?php echo esc_html( $list[1] ); ?></p><?php endif; ?>
				<table class="widefat striped fortw-rows" data-fortw-rows="<?php echo esc_attr( $key ); ?>">
					<thead><tr><?php foreach ( $list[2] as $spec ) : ?><th><?php echo esc_html( $spec[0] ); ?></th><?php endforeach; ?><th></th></tr></thead>
					<tbody>
						<?php
						foreach ( $s[ $key ] as $i => $row ) {
							echo fortw_region_row( $key, (int) $i, $list[2], $row ); // phpcs:ignore WordPress.Security.EscapeOutput -- escaped in the builder
						}
						?>
					</tbody>
				</table>
				<template data-fortw-template="<?php echo esc_attr( $key ); ?>"><?php echo fortw_region_row( $key, '__i__', $list[2], array() ); // phpcs:ignore WordPress.Security.EscapeOutput ?></template>
				<p><button type="button" class="button fortw-add-row" data-fortw-target="<?php echo esc_attr( $key ); ?>"><?php esc_html_e( 'Add a row', 'fort-weekly' ); ?></button></p>
			<?php endforeach; ?>

			<?php if ( in_array( 'fng_goal', $parts, true ) ) : ?>
				<h2><?php esc_html_e( 'FNG challenge', 'fort-weekly' ); ?></h2>
				<table class="form-table" role="presentation">
					<tr><th scope="row"><label for="fortw-goal"><?php esc_html_e( 'FNG goal this year', 'fort-weekly' ); ?></label></th>
						<td><input type="number" id="fortw-goal" name="region[fng_goal]" value="<?php echo (int) $s['fng_goal']; ?>" min="0" max="100000">
							<p class="description"><?php esc_html_e( 'The count comes from the stats site.', 'fort-weekly' ); ?></p></td></tr>
				</table>
			<?php endif; ?>

			<?php submit_button( __( 'Save', 'fort-weekly' ) ); ?>
		</form>
	</div>
	<?php
}

add_action(
	'admin_post_fortw_region',
	function () {
		check_admin_referer( 'fortw_region' );
		if ( ! current_user_can( 'manage_fort_region' ) ) {
			wp_die( esc_html__( 'Sorry, you are not allowed to do that.', 'fort-weekly' ), 403 );
		}
		$pages = fortw_region_pages();
		$slug  = isset( $_POST['fortw_page'] ) && isset( $pages[ $_POST['fortw_page'] ] ) ? sanitize_key( $_POST['fortw_page'] ) : 'fortw-region';
		$parts = $pages[ $slug ][2]; // Only this page's fields: the others keep what they have.
		$in    = (array) wp_unslash( $_POST['region'] ?? array() ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput -- each field sanitized below
		$out   = fortw_region_settings();
		if ( in_array( 'nantan', $parts, true ) ) {
			$n             = (array) ( $in['nantan'] ?? array() );
			$out['nantan'] = array(
				'text'     => wp_kses_post( (string) ( $n['text'] ?? '' ) ),
				'author'   => sanitize_text_field( (string) ( $n['author'] ?? '' ) ),
				'heading'  => sanitize_text_field( (string) ( $n['heading'] ?? '' ) ),
				'image_id' => wp_attachment_is_image( (int) ( $n['image_id'] ?? 0 ) ) ? (int) $n['image_id'] : 0,
			);
		}
		if ( in_array( 'fng_goal', $parts, true ) ) {
			$out['fng_goal'] = max( 0, min( 100000, (int) ( $in['fng_goal'] ?? 226 ) ) );
		}
		foreach ( fortw_region_lists() as $key => $list ) {
			if ( ! in_array( $key, $parts, true ) ) {
				continue;
			}
			$rows = array();
			foreach ( (array) ( $in[ $key ] ?? array() ) as $row ) {
				$clean = array();
				foreach ( $list[2] as $field => $spec ) {
					$v = (string) ( $row[ $field ] ?? '' );
					if ( is_array( $spec[1] ) ) {
						$clean[ $field ] = array_key_exists( $v, $spec[1] ) ? $v : array_key_first( $spec[1] );
					} else {
						$clean[ $field ] = 'url' === $spec[1] ? fortw_http_url( $v ) : mb_substr( sanitize_text_field( $v ), 0, 200 );
					}
				}
				$text_fields = array_filter( $list[2], function ( $spec ) { return ! is_array( $spec[1] ); } );
				if ( implode( '', array_intersect_key( $clean, $text_fields ) ) !== '' ) {
					$rows[] = $clean; // Skip rows left completely blank.
				}
			}
			$out[ $key ] = $rows;
		}
		update_option( 'fort_weekly_region', $out );
		wp_safe_redirect( admin_url( 'edit.php?post_type=' . FORTW_POST_TYPE . '&page=' . $slug . '&saved=1' ) );
		exit;
	}
);
