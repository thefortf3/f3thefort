<?php
/**
 * /submit/ — the PAX "Submit an event" form. Posts to admin-post.php, where the Fort Weekly
 * plugin turns it into a pending event for an editor to approve.
 *
 * With ?edit=<id>-<token> (the submitter's private link) it opens in edit mode, filled in with the
 * event's current details; changes go to the editors first and the live event stays as it is.
 *
 * @package Fort
 */

defined( 'ABSPATH' ) || exit;

// phpcs:disable WordPress.Security.NonceVerification.Recommended -- read-only status flags in the URL
$submitted = isset( $_GET['submitted'] );
$changed   = isset( $_GET['changed'] ) ? sanitize_key( wp_unslash( $_GET['changed'] ) ) : '';
// Not "error": WordPress removes that parameter from every front-end request.
$error  = isset( $_GET['fort_error'] ) ? sanitize_key( wp_unslash( $_GET['fort_error'] ) ) : '';
$fields = isset( $_GET['fields'] ) ? explode( ',', sanitize_text_field( wp_unslash( $_GET['fields'] ) ) ) : array();
$edit   = null;
if ( isset( $_GET['edit'] ) && function_exists( 'fort_weekly_edit_form' ) ) {
	$edit = fort_weekly_edit_form( sanitize_text_field( wp_unslash( $_GET['edit'] ) ) );
	if ( isset( $edit['error'] ) ) {
		$error = 'link';
		$edit  = null;
	}
}
$own_link = '';
if ( $submitted && isset( $_GET['fort_link'] ) && function_exists( 'fort_weekly_edit_link' ) ) {
	$own_link = fort_weekly_edit_link( sanitize_text_field( wp_unslash( $_GET['fort_link'] ) ) );
}
// phpcs:enable
if ( ! function_exists( 'fortw_handle_submission' ) ) {
	$error = 'disabled'; // The Fort Weekly plugin isn't active.
}

/** The value to fill a field with in edit mode. */
$v = function ( $key ) use ( $edit ) {
	return $edit ? (string) ( $edit[ $key ] ?? '' ) : '';
};

$messages = array(
	'expired'  => __( 'The form expired — please try again.', 'fort' ),
	'missing'  => __( 'Please fill in the highlighted fields.', 'fort' ),
	'image'    => __( 'That image could not be used. Use a JPG/PNG/GIF/WebP under 5 MB, or leave it off.', 'fort' ),
	'busy'     => __( 'Too many submissions from here — please try again in a bit.', 'fort' ),
	'disabled' => __( 'Submissions are not switched on for this site yet.', 'fort' ),
	'failed'   => __( 'Something went wrong sending your event. Please try again.', 'fort' ),
	'long'     => __( 'That description is too long — please keep it under about 8,000 characters.', 'fort' ),
	'link'     => __( 'That edit link doesn’t work any more (it may be old, or the event has passed). You can submit it as a new event below, or ask in Slack.', 'fort' ),
);

get_header();
?>
<main id="main" class="fort-wrap fort-wrap--narrow fort-submit">
	<header class="fort-entry__head">
		<span class="fort-label fort-accent2"><?php esc_html_e( 'FOR THE PAX', 'fort' ); ?></span>
		<?php if ( $edit ) : ?>
			<h1 class="fort-entry__title"><?php esc_html_e( 'Update your event', 'fort' ); ?></h1>
			<p class="fort-entry__dek">
				<?php
				echo $edit['is_live']
					? esc_html__( 'Your changes go to the editors first. Until they’re approved, your event stays on the site as it is now.', 'fort' )
					: esc_html__( 'Your event is still waiting for approval; your changes update it.', 'fort' );
				?>
				<?php if ( $edit['event_url'] ) : ?><a href="<?php echo esc_url( $edit['event_url'] ); ?>"><?php esc_html_e( 'See it as it is now ↗', 'fort' ); ?></a><?php endif; ?>
			</p>
		<?php else : ?>
			<h1 class="fort-entry__title"><?php esc_html_e( 'Submit an event', 'fort' ); ?></h1>
			<p class="fort-entry__dek"><?php esc_html_e( 'An event, an initiative, something the region should know about. Once it’s approved it goes on this site and into the next issue of The Fort Weekly.', 'fort' ); ?></p>
		<?php endif; ?>
	</header>

	<div id="submit-result" role="status">
		<?php if ( $submitted ) : ?>
			<div class="fort-alert fort-alert--ok">
				<?php if ( 'live' === $changed ) : ?>
					<strong><?php esc_html_e( 'Thanks — your changes are with the editors.', 'fort' ); ?></strong>
					<?php esc_html_e( 'Your event stays on the site as it was until they approve them.', 'fort' ); ?>
				<?php elseif ( 'pending' === $changed ) : ?>
					<strong><?php esc_html_e( 'Thanks — your event is updated.', 'fort' ); ?></strong>
					<?php esc_html_e( 'It will appear on the site and in the newsletter once it’s been approved.', 'fort' ); ?>
				<?php else : ?>
					<strong><?php esc_html_e( 'Thanks — your event is in!', 'fort' ); ?></strong>
					<?php esc_html_e( 'It will appear on the site and in the newsletter once it’s been approved.', 'fort' ); ?>
				<?php endif; ?>
				<a href="<?php echo esc_url( fort_submit_url() ); ?>"><?php esc_html_e( 'Submit another', 'fort' ); ?></a>
			</div>
			<?php if ( $own_link ) : ?>
				<div class="fort-alert fort-editlink">
					<strong><?php esc_html_e( 'Your private edit link', 'fort' ); ?></strong>
					<span><?php esc_html_e( 'Save it to change your event later (changes are checked before they go live). If you gave an email, it comes in the approval email too. Keep it to yourself: anyone with it can suggest changes.', 'fort' ); ?></span>
					<span class="fort-editlink__row">
						<input type="text" readonly value="<?php echo esc_attr( $own_link ); ?>" id="fort-editlink" aria-label="<?php esc_attr_e( 'Your edit link', 'fort' ); ?>" onclick="this.select()">
						<button type="button" class="fort-btn fort-btn--outline" onclick="var i=document.getElementById('fort-editlink');i.select();(navigator.clipboard?navigator.clipboard.writeText(i.value):Promise.reject()).then(()=>{this.textContent='Copied';}).catch(()=>{document.execCommand('copy');this.textContent='Copied';});"><?php esc_html_e( 'Copy', 'fort' ); ?></button>
					</span>
				</div>
			<?php endif; ?>
		<?php elseif ( $error ) : ?>
			<div class="fort-alert fort-alert--error"><?php echo esc_html( $messages[ $error ] ?? $messages['failed'] ); ?></div>
		<?php endif; ?>
		<?php if ( $edit && $edit['change_waiting'] ) : ?>
			<div class="fort-alert"><?php esc_html_e( 'You already sent changes that are waiting for approval; they’re filled in below. Sending again replaces them.', 'fort' ); ?></div>
		<?php endif; ?>
	</div>

	<?php if ( ! $submitted && 'disabled' !== $error ) : ?>
	<form class="fort-form" method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" enctype="multipart/form-data"
		data-current-flyer="<?php echo esc_attr( $v( 'flyer_url' ) ); ?>"
		data-fixed-when="<?php echo $edit && ! $edit['dates_editable'] ? esc_attr( $edit['dates_text'] ) : ''; ?>">
		<input type="hidden" name="action" value="fort_submit">
		<?php wp_nonce_field( 'fort_submit', 'fort_nonce' ); ?>
		<?php if ( $edit ) : ?><input type="hidden" name="fort_edit" value="<?php echo esc_attr( $edit['param'] ); ?>"><?php endif; ?>
		<div class="fort-hp" aria-hidden="true"><label for="fort-website">Website</label><input id="fort-website" name="website" tabindex="-1" autocomplete="off"></div>

		<div class="fort-field<?php echo in_array( 'title', $fields, true ) ? ' is-invalid' : ''; ?>">
			<label for="f-title"><?php esc_html_e( 'Event name', 'fort' ); ?> <span class="fort-req" aria-hidden="true">*</span></label>
			<input id="f-title" name="title" required maxlength="160" value="<?php echo esc_attr( $v( 'title' ) ); ?>">
		</div>
		<?php if ( $edit && ! $edit['dates_editable'] ) : ?>
			<div class="fort-field">
				<span class="fort-field__label"><?php esc_html_e( 'Dates', 'fort' ); ?></span>
				<p class="fort-fixed"><?php echo esc_html( $edit['dates_text'] ); ?></p>
				<p class="fort-dim fort-hint"><?php esc_html_e( 'This event has several dates, set by the editors. To change them, say so in the description or ask in Slack.', 'fort' ); ?></p>
			</div>
		<?php else : ?>
			<div class="fort-field-row">
				<div class="fort-field<?php echo in_array( 'date', $fields, true ) ? ' is-invalid' : ''; ?>"><label for="f-date"><?php esc_html_e( 'Date', 'fort' ); ?></label><input id="f-date" name="start_date" type="date" value="<?php echo esc_attr( $v( 'date' ) ); ?>"></div>
				<div class="fort-field"><label for="f-start"><?php esc_html_e( 'Start', 'fort' ); ?></label><input id="f-start" name="start_time" placeholder="0530" maxlength="40" value="<?php echo esc_attr( $v( 'start_time' ) ); ?>"></div>
				<div class="fort-field"><label for="f-end"><?php esc_html_e( 'End', 'fort' ); ?></label><input id="f-end" name="end_time" placeholder="0630" maxlength="40" value="<?php echo esc_attr( $v( 'end_time' ) ); ?>"></div>
			</div>
		<?php endif; ?>
		<div class="fort-field-row">
			<div class="fort-field fort-field--grow"><label for="f-location"><?php esc_html_e( 'Where', 'fort' ); ?></label><input id="f-location" name="location" maxlength="200" value="<?php echo esc_attr( $v( 'location' ) ); ?>"></div>
			<div class="fort-field"><label for="f-leader"><?php esc_html_e( 'Q (who’s leading)', 'fort' ); ?></label><input id="f-leader" name="leader" maxlength="120" value="<?php echo esc_attr( $v( 'leader' ) ); ?>"></div>
		</div>
		<div class="fort-field<?php echo in_array( 'description', $fields, true ) ? ' is-invalid' : ''; ?>">
			<label for="fort_description"><?php esc_html_e( 'Tell the PAX about it', 'fort' ); ?> <span class="fort-req" aria-hidden="true">*</span></label>
			<?php
			// WordPress's classic editor with just bold, italic, lists and links. The site keeps only
			// those (fortw_submission_html in the Fort Weekly plugin). Without JavaScript it's a plain
			// text box.
			wp_editor(
				$edit ? wp_kses_post( $edit['description'] ) : '',
				'fort_description',
				array(
					'textarea_name'    => 'description',
					'textarea_rows'    => 8,
					'media_buttons'    => false,
					'teeny'            => true,
					'quicktags'        => false,
					'drag_drop_upload' => false,
					'tinymce'          => array(
						'toolbar1'       => 'bold,italic,bullist,numlist,link,unlink,undo,redo',
						'toolbar2'       => '',
						'menubar'        => false,
						'statusbar'      => false,
						'branding'       => false,
						'valid_elements' => 'p,br,strong/b,em/i,ul,ol,li,a[href]',
						// One URL only: TinyMCE splits this setting on commas (the font loads from inside it).
						'content_css'    => get_template_directory_uri() . '/assets/editor-content.css?ver=' . FORT_THEME_VERSION,
						'body_class'     => 'fort-editor-body',
					),
				)
			);
			?>
		</div>
		<div class="fort-field"><label for="f-link"><?php esc_html_e( 'Sign-up or details link', 'fort' ); ?></label><input id="f-link" name="link" type="url" placeholder="https://…" value="<?php echo esc_attr( $v( 'link' ) ); ?>"></div>
		<div class="fort-field">
			<?php if ( $v( 'flyer_url' ) ) : ?>
				<span class="fort-field__label"><?php esc_html_e( 'Current flyer', 'fort' ); ?></span>
				<img class="fort-current-flyer" src="<?php echo esc_url( $v( 'flyer_url' ) ); ?>" alt="">
				<label class="fort-check"><input type="checkbox" name="remove_flyer" value="1" id="f-remove-flyer"> <?php esc_html_e( 'Remove this flyer', 'fort' ); ?></label>
				<label for="f-flyer"><?php esc_html_e( 'Or replace it (under 5 MB)', 'fort' ); ?></label>
			<?php else : ?>
				<label for="f-flyer"><?php esc_html_e( 'Flyer or photo (optional, under 5 MB)', 'fort' ); ?></label>
			<?php endif; ?>
			<input id="f-flyer" name="flyer" type="file" accept="image/*">
		</div>

		<fieldset class="fort-fieldset">
			<legend><?php esc_html_e( 'You (only the admins see this)', 'fort' ); ?></legend>
			<div class="fort-field-row">
				<div class="fort-field fort-field--grow"><label for="f-name"><?php esc_html_e( 'F3 name', 'fort' ); ?></label><input id="f-name" name="submitter_name" maxlength="120" autocomplete="nickname" value="<?php echo esc_attr( $v( 'submitter_name' ) ); ?>"></div>
				<div class="fort-field fort-field--grow"><label for="f-email"><?php esc_html_e( 'Email', 'fort' ); ?></label><input id="f-email" name="submitter_email" type="email" autocomplete="email" value="<?php echo esc_attr( $v( 'submitter_email' ) ); ?>"></div>
				<div class="fort-field"><label for="f-phone"><?php esc_html_e( 'Phone', 'fort' ); ?></label><input id="f-phone" name="submitter_phone" type="tel" autocomplete="tel" value="<?php echo esc_attr( $v( 'submitter_phone' ) ); ?>"></div>
			</div>
			<p class="fort-dim fort-hint"><?php esc_html_e( 'With an email, we’ll let you know when it’s live and send your private edit link.', 'fort' ); ?></p>
		</fieldset>

		<div class="fort-actions">
			<?php // With JavaScript, "Preview" replaces the plain send button (assets/submit-preview.js). ?>
			<button class="fort-btn" type="button" id="fort-preview-open" hidden><?php esc_html_e( 'Preview', 'fort' ); ?></button>
			<button class="fort-btn" type="submit" id="fort-send"><?php echo $edit ? esc_html__( 'Send changes for approval', 'fort' ) : esc_html__( 'Send for approval', 'fort' ); ?></button>
		</div>
	</form>

	<section id="fort-preview" class="fort-preview" hidden aria-labelledby="fort-preview-label">
		<p class="fort-preview__banner" id="fort-preview-label" tabindex="-1">
			<strong><?php esc_html_e( 'Preview', 'fort' ); ?></strong>
			<?php
			echo $edit && $edit['is_live']
				? esc_html__( 'This is how your event will look once your changes are approved. Nothing has been sent yet.', 'fort' )
				: esc_html__( 'This is how your event will look on the site once it’s approved. Nothing has been sent yet.', 'fort' );
			?>
		</p>
		<div class="fort-preview__page">
			<header class="fort-entry__head">
				<h1 class="fort-entry__title" data-preview="title"></h1>
			</header>
			<figure class="fort-entry__hero" data-preview="flyer" hidden><img alt=""></figure>
			<p class="fort-alert fort-alert--error" data-preview="flyer-problem" hidden><?php esc_html_e( 'That flyer won’t go through: use a JPG, PNG, GIF or WebP under 5 MB, or leave it off.', 'fort' ); ?></p>
			<dl class="fort-facts">
				<dt><?php esc_html_e( 'When', 'fort' ); ?></dt>
				<dd data-preview="when"></dd>
				<dt data-preview-row="where"><?php esc_html_e( 'Where', 'fort' ); ?></dt>
				<dd data-preview-row="where" data-preview="where"></dd>
				<dt data-preview-row="q"><?php esc_html_e( 'Q', 'fort' ); ?></dt>
				<dd data-preview-row="q" data-preview="q"></dd>
			</dl>
			<div class="fort-actions fort-actions--full" data-preview="link-row" hidden>
				<span class="fort-btn"><?php esc_html_e( 'Details / register ↗', 'fort' ); ?></span>
			</div>
			<div class="fort-prose" data-preview="description"></div>
		</div>
		<div class="fort-actions fort-preview__actions">
			<button class="fort-btn" type="button" id="fort-preview-send"><?php echo $edit ? esc_html__( 'Looks good — send changes for approval', 'fort' ) : esc_html__( 'Looks good — send for approval', 'fort' ); ?></button>
			<button class="fort-btn fort-btn--outline" type="button" id="fort-preview-edit"><?php esc_html_e( 'Keep editing', 'fort' ); ?></button>
		</div>
	</section>
	<?php endif; ?>
</main>
<?php
get_footer();
