<?php
/**
 * The Schedule page (the page with slug "schedule"): every workout on the Q sheet, a week at a time
 * (this week / next week), from GloomSchedule via the stats API: day, time, AO, kind and the Q(s),
 * one line each, with the AOs' site Qs listed once at the bottom. Anything written on the page
 * itself (notes, links) shows above it.
 *
 * @package Fort
 */

defined( 'ABSPATH' ) || exit;

// phpcs:disable WordPress.Security.NonceVerification.Recommended -- read-only filters in the URL
$kind     = isset( $_GET['f'] ) ? sanitize_key( wp_unslash( $_GET['f'] ) ) : '';
$week     = isset( $_GET['week'] ) && 'next' === $_GET['week'] ? 'next' : 'this';
// phpcs:enable
$kinds    = array(
	''     => __( 'Everything', 'fort' ),
	'1st'  => __( '1st F · Fitness', 'fort' ),
	'2nd'  => __( '2nd F · Fellowship', 'fort' ),
	'3rd'  => __( '3rd F · Faith', 'fort' ),
);
$kind     = array_key_exists( $kind, $kinds ) ? $kind : '';
$schedule = fort_schedule( 14 );

get_header();
?>
<main id="main" class="fort-entry fort-schedule">
	<div class="fort-wrap">
		<?php while ( have_posts() ) : the_post(); ?>
			<header class="fort-entry__head fort-schedule__head">
				<span class="fort-kicker fort-accent2"><?php esc_html_e( 'In the gloom', 'fort' ); ?></span>
				<h1 class="fort-entry__title"><?php the_title(); ?></h1>
				<p class="fort-entry__dek"><?php esc_html_e( 'Every workout on the Q sheet, a week at a time. No sign-up and no cost — just show up a few minutes early.', 'fort' ); ?></p>
			</header>
			<?php // The page's own content isn't shown: on the live site it holds the previous theme's map and tables. ?>
			<p class="fort-schedule__notes"><?php esc_html_e( 'Our workout schedule is right most of the time, but weather, holidays and special events can change things. Check the Fort’s Slack for updates (requires invite).', 'fort' ); ?></p>
		<?php endwhile; ?>

		<?php
		$url = function ( $args ) use ( $kind, $week ) {
			$args = array_merge( array( 'f' => $kind, 'week' => 'next' === $week ? 'next' : '' ), $args );
			return add_query_arg( array_filter( $args ), get_permalink() );
		};
		?>
		<div class="fort-sched-bar">
			<nav class="fort-chips fort-chips--tabs" aria-label="<?php esc_attr_e( 'Week', 'fort' ); ?>">
				<a class="fort-chip<?php echo 'this' === $week ? ' is-current' : ''; ?>" href="<?php echo esc_url( $url( array( 'week' => '' ) ) ); ?>"<?php echo 'this' === $week ? ' aria-current="page"' : ''; ?>><?php esc_html_e( 'This week', 'fort' ); ?></a>
				<a class="fort-chip<?php echo 'next' === $week ? ' is-current' : ''; ?>" href="<?php echo esc_url( $url( array( 'week' => 'next' ) ) ); ?>"<?php echo 'next' === $week ? ' aria-current="page"' : ''; ?>><?php esc_html_e( 'Next week', 'fort' ); ?></a>
			</nav>
			<nav class="fort-chips" aria-label="<?php esc_attr_e( 'Show', 'fort' ); ?>">
				<?php foreach ( $kinds as $key => $label ) : ?>
					<a class="fort-chip<?php echo $kind === $key ? ' is-current' : ''; ?>" href="<?php echo esc_url( $url( array( 'f' => $key ) ) ); ?>"<?php echo $kind === $key ? ' aria-current="page"' : ''; ?>><?php echo esc_html( $label ); ?></a>
				<?php endforeach; ?>
			</nav>
		</div>

		<?php if ( ! $schedule ) : ?>
			<p class="fort-notice"><?php esc_html_e( 'The Q sheet can’t be reached right now. Check back in a few minutes, or ask in Slack.', 'fort' ); ?></p>
		<?php else : ?>
			<?php fort_render_schedule_page( $schedule, $kind, 'next' === $week ? 7 : 0, 7 ); ?>
		<?php endif; ?>

		<p class="fort-dim fort-schedule__foot">
			<?php esc_html_e( 'From the Q sheet, updated every few minutes. Things change — weather, holidays — so check Slack if in doubt.', 'fort' ); ?>
			<a class="fort-accent2" href="https://app.gloomschedule.com/"><?php esc_html_e( 'Want to Q? Sign up ↗', 'fort' ); ?></a>
		</p>
	</div>
</main>
<?php
get_footer();
