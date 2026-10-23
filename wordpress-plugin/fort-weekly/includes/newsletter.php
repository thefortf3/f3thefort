<?php
/**
 * Fort Weekly → Newsletter: this week's issue, built from the approved events and region info.
 * Preview it at phone and email widths, download the email-ready HTML, or save it to Mailchimp
 * as a draft (never sent from here).
 *
 * @package FortWeekly
 */

defined( 'ABSPATH' ) || exit;

if ( file_exists( FORT_WEEKLY_DIR . '/vendor/autoload.php' ) ) {
	require_once FORT_WEEKLY_DIR . '/vendor/autoload.php';
}

/**
 * The issue as rendered (styles still in a <style> block — right for the browser preview).
 * The 'fortw_newsletter_template' filter gets the template (CSS and all) before it's filled; the
 * theme's style preview uses it to try other styles.
 */
function fortw_newsletter_html( $today = null ) {
	$today    = $today ? $today : fortw_today();
	$site     = untrailingslashit( home_url() );
	$template = file_get_contents( FORT_WEEKLY_DIR . '/templates/newsletter-agenda.html' ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
	return fortw_render_agenda(
		(string) apply_filters( 'fortw_newsletter_template', $template ),
		fortw_list_entries( array( 'upcoming_only' => true, 'today' => $today ) ),
		fort_weekly_region(),
		$today,
		array(
			'site_url'   => $site,
			'submit_url' => home_url( '/submit/' ),
			'year'       => substr( $today, 0, 4 ),
			'entry_url'  => function ( $e ) use ( $site ) {
				return $site . '/events/' . rawurlencode( $e['slug'] ) . '/';
			},
		)
	);
}

/**
 * The issue ready for email: every style inlined (email clients ignore most <style> blocks), the
 * @media rules kept in the head, background colours repeated as bgcolor attributes (Outlook), and
 * Impact dropped from the font stack (Gmail can't load the web fonts and Impact is far heavier
 * than Oswald). As the app's prepareForEmail() did with Juice.
 */
function fortw_prepare_for_email( $html ) {
	if ( class_exists( '\Pelago\Emogrifier\CssInliner' ) ) {
		$html = \Pelago\Emogrifier\CssInliner::fromHtml( $html )->inlineCss()->render();
		$html = \Pelago\Emogrifier\HtmlProcessor\CssToAttributeConverter::fromHtml( $html )->convertCssToVisualAttributes()->render();
	} else {
		error_log( 'Fort Weekly: vendor/ is missing, so the email HTML was not inlined. Build the plugin with scripts/build-plugin-zip.sh.' );
	}
	return preg_replace( '/,\s*Impact/i', '', $html );
}

/** What this week's issue contains, for the screen's summary line. */
function fortw_newsletter_counts( $today ) {
	$entries = fortw_list_entries( array( 'upcoming_only' => true, 'today' => $today ) );
	$sel     = fortw_select_issue( $entries, $today );
	$held    = count( array_filter( $entries, function ( $e ) { return $e['hold_from_newsletter']; } ) );
	return array(
		'featured'  => $sel['featured'] ? $sel['featured']['title'] : '',
		'this_week' => array_sum( array_map( function ( $d ) { return count( $d['entries'] ); }, $sel['this_week'] ) ),
		'coming_up' => count( $sel['coming_up'] ),
		'ongoing'   => count( $sel['ongoing'] ),
		'held'      => $held,
	);
}

add_action(
	'admin_menu',
	function () {
		add_submenu_page(
			'edit.php?post_type=' . FORTW_POST_TYPE,
			__( 'The Fort Weekly', 'fort-weekly' ),
			__( 'Newsletter', 'fort-weekly' ),
			'manage_fort_newsletter',
			'fortw-newsletter',
			'fortw_render_newsletter_page'
		);
	},
	25
);

function fortw_nl_action_url( $action ) {
	return wp_nonce_url( admin_url( 'admin-post.php?action=' . $action ), $action );
}

function fortw_render_newsletter_page() {
	if ( ! current_user_can( 'manage_fort_newsletter' ) ) {
		wp_die( esc_html__( 'Sorry, you are not allowed to do that.', 'fort-weekly' ) );
	}
	$today  = fortw_today();
	$c      = fortw_newsletter_counts( $today );
	$sunday = fortw_next_sunday( $today );
	$log    = array_slice( (array) get_option( 'fortw_issue_log', array() ), 0, 8 );
	$result = get_transient( 'fortw_mc_result_' . get_current_user_id() );
	if ( $result ) {
		delete_transient( 'fortw_mc_result_' . get_current_user_id() );
	}
	?>
	<div class="wrap fortw-newsletter">
		<h1><?php esc_html_e( 'The Fort Weekly', 'fort-weekly' ); ?></h1>
		<?php if ( $result ) : ?>
			<div class="notice <?php echo empty( $result['error'] ) ? 'notice-success' : 'notice-error'; ?>"><p><?php echo esc_html( $result['message'] ); ?></p></div>
		<?php endif; ?>
		<p>
			<?php
			/* translators: 1: number this week, 2: number coming up, 3: number ongoing */
			echo esc_html( sprintf( __( 'This week’s issue: %1$d this week, %2$d coming up, %3$d ongoing.', 'fort-weekly' ), $c['this_week'], $c['coming_up'], $c['ongoing'] ) );
			if ( $c['featured'] ) {
				/* translators: %s: event title */
				echo ' ' . esc_html( sprintf( __( 'Featured: %s.', 'fort-weekly' ), $c['featured'] ) );
			}
			if ( $c['held'] ) {
				/* translators: %d: number of events */
				echo ' ' . esc_html( sprintf( _n( '%d event is held out.', '%d events are held out.', $c['held'], 'fort-weekly' ), $c['held'] ) );
			}
			?>
			<?php esc_html_e( 'It always reflects what’s approved right now; change events or region info and reload.', 'fort-weekly' ); ?>
		</p>

		<div class="fortw-nl-bar">
			<span class="fortw-nl-widths" role="group" aria-label="<?php esc_attr_e( 'Preview width', 'fort-weekly' ); ?>">
				<button type="button" class="button" data-width="390" aria-pressed="true"><?php esc_html_e( 'Phone', 'fort-weekly' ); ?></button>
				<button type="button" class="button" data-width="640" aria-pressed="false"><?php esc_html_e( 'Email width', 'fort-weekly' ); ?></button>
			</span>
			<a class="button" href="<?php echo esc_url( fortw_nl_action_url( 'fortw_nl_download' ) ); ?>"><?php esc_html_e( 'Download email HTML', 'fort-weekly' ); ?></a>
			<?php if ( fortw_mailchimp_configured() ) : ?>
				<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" class="fortw-inline"
					onsubmit="return confirm('<?php echo esc_js( sprintf( /* translators: %s: campaign name */ __( 'Save this issue to Mailchimp as the draft “%s”? Nothing is sent: you schedule and send it in Mailchimp.', 'fort-weekly' ), fortw_campaign_title( $sunday ) ) ); ?>');">
					<input type="hidden" name="action" value="fortw_nl_mailchimp">
					<?php wp_nonce_field( 'fortw_nl_mailchimp' ); ?>
					<button class="button button-primary"><?php esc_html_e( 'Save as Mailchimp draft', 'fort-weekly' ); ?></button>
				</form>
			<?php else : ?>
				<button class="button button-primary" disabled><?php esc_html_e( 'Save as Mailchimp draft', 'fort-weekly' ); ?></button>
				<span class="description"><?php esc_html_e( 'Needs FORT_MAILCHIMP_API_KEY and FORT_MAILCHIMP_LIST_ID in wp-config.php.', 'fort-weekly' ); ?></span>
			<?php endif; ?>
		</div>
		<p class="description">
			<?php
			/* translators: %s: campaign name, e.g. October 25, 2026 */
			echo esc_html( sprintf( __( 'Mailchimp: creates or updates the draft named “%s”. Nothing is ever sent or scheduled from WordPress.', 'fort-weekly' ), fortw_campaign_title( $sunday ) ) );
			?>
		</p>

		<iframe class="fortw-nl-preview" title="<?php esc_attr_e( 'Newsletter preview', 'fort-weekly' ); ?>" src="<?php echo esc_url( fortw_nl_action_url( 'fortw_nl_preview' ) ); ?>" width="390" height="1400"></iframe>

		<?php if ( $log ) : ?>
			<h2><?php esc_html_e( 'Recent Mailchimp drafts', 'fort-weekly' ); ?></h2>
			<table class="widefat striped" style="max-width:760px">
				<thead><tr><th><?php esc_html_e( 'When', 'fort-weekly' ); ?></th><th><?php esc_html_e( 'Campaign', 'fort-weekly' ); ?></th><th><?php esc_html_e( 'By', 'fort-weekly' ); ?></th><th><?php esc_html_e( 'Events', 'fort-weekly' ); ?></th></tr></thead>
				<tbody>
					<?php foreach ( $log as $row ) : ?>
						<tr>
							<td><?php echo esc_html( get_date_from_gmt( $row['at'], 'M j, g:ia' ) ); ?></td>
							<td><?php echo esc_html( $row['title'] . ' (' . $row['action'] . ')' ); ?></td>
							<td><?php echo esc_html( $row['user'] ); ?></td>
							<td><?php echo (int) count( $row['entries'] ); ?></td>
						</tr>
					<?php endforeach; ?>
				</tbody>
			</table>
		<?php endif; ?>
	</div>
	<script>
	document.querySelectorAll('.fortw-nl-widths button').forEach(function (b) {
		b.addEventListener('click', function () {
			document.querySelector('.fortw-nl-preview').width = b.dataset.width;
			document.querySelectorAll('.fortw-nl-widths button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
		});
	});
	</script>
	<?php
}

function fortw_nl_check( $action ) {
	check_admin_referer( $action );
	if ( ! current_user_can( 'manage_fort_newsletter' ) ) {
		wp_die( esc_html__( 'Sorry, you are not allowed to do that.', 'fort-weekly' ), 403 );
	}
	nocache_headers();
}

// The preview, as an email client would get it (inlined), for the iframe.
add_action(
	'admin_post_fortw_nl_preview',
	function () {
		fortw_nl_check( 'fortw_nl_preview' );
		header( 'Content-Type: text/html; charset=utf-8' );
		header( 'X-Frame-Options: SAMEORIGIN' );
		echo fortw_prepare_for_email( fortw_newsletter_html() ); // phpcs:ignore WordPress.Security.EscapeOutput -- built and escaped by fortw_render_agenda
		exit;
	}
);

add_action(
	'admin_post_fortw_nl_download',
	function () {
		fortw_nl_check( 'fortw_nl_download' );
		$today = fortw_today();
		header( 'Content-Type: text/html; charset=utf-8' );
		header( 'Content-Disposition: attachment; filename="fort-weekly-' . fortw_next_sunday( $today ) . '.html"' );
		echo fortw_prepare_for_email( fortw_newsletter_html( $today ) ); // phpcs:ignore WordPress.Security.EscapeOutput
		exit;
	}
);

add_action(
	'admin_post_fortw_nl_mailchimp',
	function () {
		fortw_nl_check( 'fortw_nl_mailchimp' );
		$today  = fortw_today();
		$result = fortw_mc_save_draft( fortw_prepare_for_email( fortw_newsletter_html( $today ) ), $today );
		if ( is_wp_error( $result ) ) {
			$note = array( 'error' => true, 'message' => $result->get_error_message() );
		} else {
			$sel  = fortw_select_issue( fortw_list_entries( array( 'upcoming_only' => true, 'today' => $today ) ), $today );
			$ids  = array_merge(
				$sel['featured'] ? array( $sel['featured']['id'] ) : array(),
				array_merge( array(), ...array_map( function ( $d ) { return array_column( $d['entries'], 'id' ); }, $sel['this_week'] ) ),
				array_column( $sel['coming_up'], 'id' ),
				array_column( $sel['ongoing'], 'id' )
			);
			$log = (array) get_option( 'fortw_issue_log', array() );
			array_unshift(
				$log,
				array( 'at' => current_time( 'mysql', true ), 'user' => wp_get_current_user()->display_name, 'title' => $result['title'], 'campaign_id' => $result['id'], 'action' => $result['action'], 'entries' => $ids )
			);
			update_option( 'fortw_issue_log', array_slice( $log, 0, 52 ), false );
			$note = array(
				/* translators: 1: created/updated, 2: campaign name */
				'message' => sprintf( __( 'Mailchimp draft %1$s: “%2$s”. Review, schedule and send it in Mailchimp.', 'fort-weekly' ), 'created' === $result['action'] ? __( 'created', 'fort-weekly' ) : __( 'updated', 'fort-weekly' ), $result['title'] ),
			);
		}
		set_transient( 'fortw_mc_result_' . get_current_user_id(), $note, 120 );
		wp_safe_redirect( admin_url( 'edit.php?post_type=' . FORTW_POST_TYPE . '&page=fortw-newsletter' ) );
		exit;
	}
);
