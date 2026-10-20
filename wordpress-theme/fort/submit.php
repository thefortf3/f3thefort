<?php
/**
 * /submit/ — the PAX "Submit an event" form. Posts to admin-post.php, where the Fort Weekly
 * plugin turns it into a pending event for an editor to approve.
 *
 * @package Fort
 */

defined( 'ABSPATH' ) || exit;

// phpcs:disable WordPress.Security.NonceVerification.Recommended -- read-only status flags in the URL
$submitted = isset( $_GET['submitted'] );
// Not "error": WordPress removes that parameter from every front-end request.
$error     = isset( $_GET['fort_error'] ) ? sanitize_key( wp_unslash( $_GET['fort_error'] ) ) : '';
if ( ! function_exists( 'fortw_handle_submission' ) ) {
	$error = 'disabled'; // The Fort Weekly plugin isn't active.
}
$fields    = isset( $_GET['fields'] ) ? explode( ',', sanitize_text_field( wp_unslash( $_GET['fields'] ) ) ) : array();
// phpcs:enable

$messages = array(
	'expired'  => __( 'The form expired — please try again.', 'fort' ),
	'missing'  => __( 'Please fill in the highlighted fields.', 'fort' ),
	'image'    => __( 'That image could not be used. Use a JPG/PNG/GIF/WebP under 5 MB, or leave it off.', 'fort' ),
	'busy'     => __( 'Too many submissions from here — please try again in a bit.', 'fort' ),
	'disabled' => __( 'Submissions are not switched on for this site yet.', 'fort' ),
	'failed'   => __( 'Something went wrong sending your event. Please try again.', 'fort' ),
);

get_header();
?>
<main id="main" class="fort-wrap fort-wrap--narrow fort-submit">
	<header class="fort-entry__head">
		<span class="fort-label fort-accent2"><?php esc_html_e( 'FOR THE PAX', 'fort' ); ?></span>
		<h1 class="fort-entry__title"><?php esc_html_e( 'Submit an event', 'fort' ); ?></h1>
		<p class="fort-entry__dek"><?php esc_html_e( 'An event, an initiative, something the region should know about. Once it’s approved it goes on this site and into the next issue of The Fort Weekly.', 'fort' ); ?></p>
	</header>

	<div id="submit-result" role="status">
		<?php if ( $submitted ) : ?>
			<div class="fort-alert fort-alert--ok">
				<strong><?php esc_html_e( 'Thanks — your event is in!', 'fort' ); ?></strong>
				<?php esc_html_e( 'It will appear on the site and in the newsletter once it’s been approved.', 'fort' ); ?>
				<a href="<?php echo esc_url( fort_submit_url() ); ?>"><?php esc_html_e( 'Submit another', 'fort' ); ?></a>
			</div>
		<?php elseif ( $error ) : ?>
			<div class="fort-alert fort-alert--error"><?php echo esc_html( $messages[ $error ] ?? $messages['failed'] ); ?></div>
		<?php endif; ?>
	</div>

	<?php if ( ! $submitted && 'disabled' !== $error ) : ?>
	<form class="fort-form" method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" enctype="multipart/form-data">
		<input type="hidden" name="action" value="fort_submit">
		<?php wp_nonce_field( 'fort_submit', 'fort_nonce' ); ?>
		<div class="fort-hp" aria-hidden="true"><label for="fort-website">Website</label><input id="fort-website" name="website" tabindex="-1" autocomplete="off"></div>

		<div class="fort-field<?php echo in_array( 'title', $fields, true ) ? ' is-invalid' : ''; ?>">
			<label for="f-title"><?php esc_html_e( 'Event name', 'fort' ); ?> <span class="fort-req" aria-hidden="true">*</span></label>
			<input id="f-title" name="title" required maxlength="160">
		</div>
		<div class="fort-field-row">
			<div class="fort-field<?php echo in_array( 'date', $fields, true ) ? ' is-invalid' : ''; ?>"><label for="f-date"><?php esc_html_e( 'Date', 'fort' ); ?></label><input id="f-date" name="start_date" type="date"></div>
			<div class="fort-field"><label for="f-start"><?php esc_html_e( 'Start', 'fort' ); ?></label><input id="f-start" name="start_time" placeholder="0530" maxlength="40"></div>
			<div class="fort-field"><label for="f-end"><?php esc_html_e( 'End', 'fort' ); ?></label><input id="f-end" name="end_time" type="time"></div>
		</div>
		<div class="fort-field-row">
			<div class="fort-field fort-field--grow"><label for="f-location"><?php esc_html_e( 'Where', 'fort' ); ?></label><input id="f-location" name="location" maxlength="200"></div>
			<div class="fort-field"><label for="f-leader"><?php esc_html_e( 'Q (who’s leading)', 'fort' ); ?></label><input id="f-leader" name="leader" maxlength="120"></div>
		</div>
		<div class="fort-field<?php echo in_array( 'description', $fields, true ) ? ' is-invalid' : ''; ?>">
			<label for="f-description"><?php esc_html_e( 'Tell the PAX about it', 'fort' ); ?> <span class="fort-req" aria-hidden="true">*</span></label>
			<textarea id="f-description" name="description" rows="7" maxlength="8000" required></textarea>
		</div>
		<div class="fort-field"><label for="f-link"><?php esc_html_e( 'Sign-up or details link', 'fort' ); ?></label><input id="f-link" name="link" type="url" placeholder="https://…"></div>
		<div class="fort-field"><label for="f-flyer"><?php esc_html_e( 'Flyer or photo (optional, under 5 MB)', 'fort' ); ?></label><input id="f-flyer" name="flyer" type="file" accept="image/*"></div>

		<fieldset class="fort-fieldset">
			<legend><?php esc_html_e( 'You (only the admins see this)', 'fort' ); ?></legend>
			<div class="fort-field-row">
				<div class="fort-field fort-field--grow"><label for="f-name"><?php esc_html_e( 'F3 name', 'fort' ); ?></label><input id="f-name" name="submitter_name" maxlength="120" autocomplete="nickname"></div>
				<div class="fort-field fort-field--grow"><label for="f-email"><?php esc_html_e( 'Email', 'fort' ); ?></label><input id="f-email" name="submitter_email" type="email" autocomplete="email"></div>
				<div class="fort-field"><label for="f-phone"><?php esc_html_e( 'Phone', 'fort' ); ?></label><input id="f-phone" name="submitter_phone" type="tel" autocomplete="tel"></div>
			</div>
		</fieldset>

		<button class="fort-btn" type="submit"><?php esc_html_e( 'Send for approval', 'fort' ); ?></button>
	</form>
	<?php endif; ?>
</main>
<?php
get_footer();
