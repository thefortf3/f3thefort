<?php
/**
 * Homepage: featured entry, the Nan'tan's message, this week, coming up, recent backblasts,
 * stats and the weekly schedule — the full version of what the newsletter summarizes.
 *
 * @package Fort
 */

defined( 'ABSPATH' ) || exit;

get_header();

$home    = fort_home();
$region  = $home['region'] ?? array();
$summary = fort_backblast_summary();
$bbs     = fort_backblasts( 4 );
?>
<main id="main" class="fort-wrap fort-home">

<?php if ( ! $home ) : ?>
	<section class="fort-notice">
		<h1 class="fort-h2"><?php esc_html_e( 'This week in The Fort', 'fort' ); ?></h1>
		<p class="fort-dim"><?php esc_html_e( 'The event calendar is temporarily unavailable. Recent backblasts are below.', 'fort' ); ?></p>
	</section>
<?php endif; ?>

<?php if ( ! empty( $home['featured'] ) ) : $f = $home['featured']; $img = fort_entry_image( $f ); ?>
	<section class="fort-featured" aria-label="<?php esc_attr_e( 'Featured', 'fort' ); ?>">
		<?php if ( $img ) : ?>
			<a class="fort-featured__media" href="<?php echo esc_url( fort_event_url( $f ) ); ?>"><img src="<?php echo esc_url( $img ); ?>" alt=""></a>
		<?php endif; ?>
		<div class="fort-featured__body">
			<span class="fort-badge"><?php esc_html_e( 'FEATURED', 'fort' ); ?></span>
			<?php
			// When, large: the day, date and time (the flyer may not say them).
			if ( ! empty( $f['next_occurrence'] ) ) :
				$fp   = fort_date_parts( $f['next_occurrence']['date'] );
				$ft   = fort_time_label( $f['next_occurrence'] );
				$more = max( 0, count( $f['upcoming_dates'] ?? array() ) - 1 );
				?>
				<p class="fort-featured__when">
					<span class="fort-featured__date"><?php echo esc_html( $fp['long'] ); ?></span>
					<?php if ( $ft ) : ?><span class="fort-featured__time"><?php echo esc_html( $ft ); ?></span><?php endif; ?>
					<?php if ( $more ) : ?><span class="fort-mono-dim"><?php echo esc_html( sprintf( /* translators: %d: number of later dates */ _n( '+%d more date', '+%d more dates', $more, 'fort' ), $more ) ); ?></span><?php endif; ?>
				</p>
			<?php endif; ?>
			<h1 class="fort-featured__title"><a href="<?php echo esc_url( fort_event_url( $f ) ); ?>"><?php echo esc_html( $f['title'] ); ?></a></h1>
			<?php $m = fort_entry_meta( $f ); if ( $m ) : ?><div class="fort-meta"><?php echo esc_html( $m ); ?></div><?php endif; ?>
			<p class="fort-featured__summary"><?php echo esc_html( fort_summary( $f, 60 ) ); ?></p>
			<div class="fort-actions">
				<?php if ( ! empty( $f['link'] ) ) : ?>
					<a class="fort-btn" href="<?php echo esc_url( $f['link'] ); ?>"><?php esc_html_e( 'Sign up / give ↗', 'fort' ); ?></a>
				<?php endif; ?>
				<a class="fort-more" href="<?php echo esc_url( fort_event_url( $f ) ); ?>"><?php esc_html_e( 'Read the full story →', 'fort' ); ?></a>
			</div>
		</div>
	</section>
<?php endif; ?>

<?php
// Who we are: what F3 is and what The Fort is, for anyone landing here for the first time.
// (The Nan'tan's note, FNG count and shovel flags stay in the newsletter.)
$fs_tiles = array(
	array( '1st F', __( 'Fitness', 'fort' ), __( 'Outdoor beatdowns for every fitness level, led by a different man each day. The group stays together.', 'fort' ) ),
	array( '2nd F', __( 'Fellowship', 'fort' ), __( 'The reason men keep coming back: friendships built in the gloom, over coffee and lunch.', 'fort' ) ),
	array( '3rd F', __( 'Faith', 'fort' ), __( 'Something bigger than yourself — Bible studies, service projects, and men showing up for each other.', 'fort' ) ),
);
$principles = array(
	__( 'Free of charge', 'fort' ),
	__( 'Open to all men', 'fort' ),
	__( 'Outdoors, rain or shine, heat or cold', 'fort' ),
	__( 'Led by the men who post, in rotation — no certification needed', 'fort' ),
	__( 'Ends with a Circle of Trust', 'fort' ),
);
?>
<?php // Veterans can hide this; a slim bar takes its place to bring it back (assets/home.js). ?>
<p class="fort-about-bar">
	<span><?php esc_html_e( 'New to F3?', 'fort' ); ?></span>
	<button type="button" class="fort-about-bar__show" aria-controls="who-we-are" aria-expanded="false"><?php esc_html_e( 'Who we are', 'fort' ); ?> <span aria-hidden="true">▾</span></button>
</p>
<section id="who-we-are" class="fort-about" aria-labelledby="fort-about-title">
	<button type="button" class="fort-about__hide" aria-controls="who-we-are"><?php esc_html_e( 'Hide this on future visits', 'fort' ); ?> <span aria-hidden="true">✕</span></button>
	<div class="fort-about__intro">
		<span class="fort-kicker"><?php esc_html_e( 'Who we are', 'fort' ); ?></span>
		<h2 id="fort-about-title" class="fort-about__title"><?php echo esc_html( fort_about( 'fort_about_heading' ) ); ?></h2>
		<p class="fort-about__lede"><?php echo esc_html( fort_about( 'fort_about_f3' ) ); ?></p>
		<p><?php echo esc_html( fort_about( 'fort_about_fort' ) ); ?></p>
		<div class="fort-about__fng">
			<p><?php echo esc_html( fort_about( 'fort_about_fng' ) ); ?></p>
			<div class="fort-actions">
				<a class="fort-btn" href="<?php echo esc_url( fort_page_url( 'locations', home_url( '/#workouts' ) ) ); ?>"><?php esc_html_e( 'Find a workout', 'fort' ); ?></a>
				<a class="fort-more" href="<?php echo esc_url( fort_page_url( 'mission-of-f3', 'https://f3nation.com/' ) ); ?>"><?php esc_html_e( 'More about F3 →', 'fort' ); ?></a>
			</div>
		</div>
	</div>
	<div class="fort-about__side">
		<ul class="fort-fs">
			<?php foreach ( $fs_tiles as $t ) : ?>
				<li class="fort-fs__tile">
					<span class="fort-fs__num"><?php echo esc_html( $t[0] ); ?></span>
					<span class="fort-fs__name"><?php echo esc_html( $t[1] ); ?></span>
					<span class="fort-fs__text"><?php echo esc_html( $t[2] ); ?></span>
				</li>
			<?php endforeach; ?>
		</ul>
		<div class="fort-principles">
			<a class="fort-label fort-principles__head" href="<?php echo esc_url( fort_page_url( '5-core-principles', home_url( '/#who-we-are' ) ) ); ?>"><?php esc_html_e( 'Every F3 workout is…', 'fort' ); ?></a>
			<ol class="fort-principles__list">
				<?php foreach ( $principles as $p ) : ?><li><?php echo esc_html( $p ); ?></li><?php endforeach; ?>
			</ol>
		</div>
	</div>
</section>

<div class="fort-columns">
	<div class="fort-columns__main">

		<?php if ( $home ) : ?>
			<section id="this-week" class="fort-section">
				<header class="fort-section__head fort-section__head--amber">
					<h2 class="fort-h2"><span class="fort-kicker"><?php esc_html_e( 'On the calendar', 'fort' ); ?></span><?php esc_html_e( 'This week', 'fort' ); ?></h2>
					<?php $a = fort_date_parts( $home['range']['from'] ); $b = fort_date_parts( $home['range']['to'] ); ?>
					<span class="fort-mono-dim"><?php echo esc_html( $a['mon'] . ' ' . $a['day'] . ' – ' . ( $a['mon'] === $b['mon'] ? '' : $b['mon'] . ' ' ) . $b['day'] ); ?></span>
				</header>
				<?php if ( $home['this_week'] ) : ?>
					<?php foreach ( $home['this_week'] as $day ) { fort_render_day( $day ); } ?>
				<?php else : ?>
					<p class="fort-dim fort-empty"><?php esc_html_e( 'Nothing on the calendar for the next seven days yet.', 'fort' ); ?> <a href="<?php echo esc_url( fort_submit_url() ); ?>"><?php esc_html_e( 'Add something →', 'fort' ); ?></a></p>
				<?php endif; ?>
			</section>
		<?php endif; ?>

		<?php
		// Today's and tomorrow's workouts (GloomSchedule, via the stats API). Independent of the
		// events, so it shows even when the calendar is empty.
		$schedule = fort_schedule();
		if ( $schedule ) :
			?>
			<section id="workouts" class="fort-section fort-band">
				<header class="fort-section__head fort-section__head--accent2">
					<h2 class="fort-h2"><span class="fort-kicker fort-accent2"><?php esc_html_e( 'In the gloom', 'fort' ); ?></span><?php esc_html_e( 'Upcoming workouts', 'fort' ); ?></h2>
					<a class="fort-more fort-accent2" href="<?php echo esc_url( fort_page_url( 'schedule', 'https://app.gloomschedule.com/' ) ); ?>"><?php esc_html_e( 'Full schedule →', 'fort' ); ?></a>
				</header>
				<?php fort_render_schedule( $schedule, $schedule['from'] ); ?>
			</section>
		<?php endif; ?>

		<?php
		// "Every week" again, for when the sidebar stacks under everything (phones, small tablets):
		// the 2nd and 3rd F belong next to the workouts, not eight screens down. Fitness is left out
		// here, since its links repeat "Full schedule". CSS shows this copy or the sidebar's, never both.
		if ( fort_every_week_columns( $region, array( 'fitness' ) ) ) :
			?>
			<section class="fort-section fort-every-stacked" aria-labelledby="fort-every-stacked-title">
				<header class="fort-section__head fort-section__head--accent2">
					<h2 id="fort-every-stacked-title" class="fort-h2"><span class="fort-kicker fort-accent2"><?php esc_html_e( '2nd F · 3rd F', 'fort' ); ?></span><?php esc_html_e( 'Every week', 'fort' ); ?></h2>
				</header>
				<div class="fort-every-stacked__cols"><?php fort_render_every_week( $region, array( 'fitness' ) ); ?></div>
			</section>
		<?php endif; ?>

		<?php if ( ! empty( $home['coming_up'] ) ) : ?>
			<section id="coming-up" class="fort-section">
				<header class="fort-section__head fort-section__head--amber">
					<h2 class="fort-h2"><span class="fort-kicker"><?php esc_html_e( 'Further out', 'fort' ); ?></span><?php esc_html_e( 'Coming up', 'fort' ); ?></h2>
				</header>
				<div class="fort-coming-grid">
					<?php foreach ( $home['coming_up'] as $e ) { fort_render_coming_row( $e ); } ?>
				</div>
			</section>
		<?php endif; ?>


		<section id="backblasts" class="fort-section fort-band">
			<header class="fort-section__head fort-section__head--accent2">
				<h2 class="fort-h2"><span class="fort-kicker fort-accent2"><?php esc_html_e( 'Backblasts', 'fort' ); ?></span><?php esc_html_e( 'From the gloom', 'fort' ); ?></h2>
				<?php $bb_page = get_page_by_path( 'backblasts' ); ?>
				<a class="fort-more fort-accent2" href="<?php echo esc_url( $bb_page ? get_permalink( $bb_page ) : home_url( '/?post_type=post' ) ); ?>"><?php esc_html_e( 'All backblasts →', 'fort' ); ?></a>
			</header>
			<div class="fort-bb-grid">
				<?php
				if ( $bbs ) {
					foreach ( $bbs as $b ) {
						fort_render_backblast( $b );
					}
				} else {
					// Stats API unavailable: fall back to the latest backblast posts on this site.
					$recent = new WP_Query( array( 'posts_per_page' => 4, 'ignore_sticky_posts' => true, 'category__not_in' => array_filter( array( get_cat_ID( 'Pre-Blast' ) ) ) ) );
					while ( $recent->have_posts() ) {
						$recent->the_post();
						fort_render_post_card();
					}
					wp_reset_postdata();
				}
				?>
			</div>
			<?php if ( isset( $summary['workouts'] ) ) : ?>
				<p class="fort-dim"><?php echo esc_html( sprintf( /* translators: %d: number of backblasts */ _n( '%d backblast posted last week.', '%d backblasts posted last week.', (int) $summary['workouts'], 'fort' ), (int) $summary['workouts'] ) ); ?>
					<?php if ( isset( $summary['missing_backblasts'] ) && $summary['missing_backblasts'] > 0 ) : ?>
						<?php echo esc_html( sprintf( /* translators: %d: number missing */ _n( '%d scheduled workout still needs one.', '%d scheduled workouts still need one.', (int) $summary['missing_backblasts'], 'fort' ), (int) $summary['missing_backblasts'] ) ); ?>
					<?php endif; ?>
				</p>
			<?php endif; ?>
		</section>

		<?php if ( ! empty( $home['ongoing'] ) ) : ?>
			<section class="fort-section">
				<header class="fort-section__head fort-section__head--amber"><h2 class="fort-h2"><span class="fort-kicker"><?php esc_html_e( 'Any time', 'fort' ); ?></span><?php esc_html_e( 'Ongoing', 'fort' ); ?></h2></header>
				<div class="fort-ongoing-grid">
					<?php foreach ( $home['ongoing'] as $e ) : ?>
						<a class="fort-card" href="<?php echo esc_url( fort_event_url( $e ) ); ?>">
							<span class="fort-card__title"><?php echo esc_html( $e['title'] ); ?></span>
							<?php if ( empty( $e['featured'] ) ) : ?><span class="fort-card__text"><?php echo esc_html( fort_summary( $e, 26 ) ); ?></span><?php else : ?><span class="fort-badge"><?php esc_html_e( 'FEATURED', 'fort' ); ?></span><?php endif; ?>
						</a>
					<?php endforeach; ?>
				</div>
			</section>
		<?php endif; ?>
	</div>

	<aside class="fort-columns__side">
		<?php $subscribe = get_theme_mod( 'fort_subscribe_url', '' ); if ( $subscribe ) : ?>
			<section class="fort-panel fort-panel--accent2">
				<h2 class="fort-h3"><?php esc_html_e( 'The Fort Weekly', 'fort' ); ?></h2>
				<p><?php esc_html_e( 'This page, summed up in your inbox every Sunday.', 'fort' ); ?></p>
				<a class="fort-btn" href="<?php echo esc_url( $subscribe ); ?>"><?php esc_html_e( 'Subscribe ↗', 'fort' ); ?></a>
			</section>
		<?php endif; ?>

		<?php if ( $summary ) : ?>
			<section class="fort-side-section fort-band--phone">
				<h2 class="fort-h3 fort-side-section__head"><?php esc_html_e( 'Last week in the gloom', 'fort' ); ?></h2>
				<div class="fort-stats-grid">
					<div><span class="fort-stat__num"><?php echo esc_html( (int) $summary['workouts'] ); ?></span><span class="fort-label"><?php esc_html_e( 'workouts', 'fort' ); ?></span></div>
					<div><span class="fort-stat__num"><?php echo esc_html( (int) $summary['pax_posts'] ); ?></span><span class="fort-label"><?php esc_html_e( 'PAX posts', 'fort' ); ?></span></div>
					<div><span class="fort-stat__num"><?php echo esc_html( (int) $summary['unique_pax'] ); ?></span><span class="fort-label"><?php esc_html_e( 'different men', 'fort' ); ?></span></div>
					<div><span class="fort-stat__num fort-amber"><?php echo isset( $summary['fngs'] ) && function_exists( 'fort_stats_sheet_fngs' ) ? esc_html( (int) $summary['fngs'] ) : '—'; // FNGs from the sign-up sheet only. ?></span><span class="fort-label"><?php esc_html_e( 'FNGs', 'fort' ); ?></span></div>
				</div>
				<?php
				$trend = array_slice( $summary['weekly_trend'] ?? array(), -8 );
				if ( $trend ) :
					$max = max( 1, max( array_map( fn( $w ) => (int) $w['posts'], $trend ) ) );
					$label = implode( ', ', array_map( fn( $w ) => (int) $w['posts'], $trend ) );
					?>
					<svg class="fort-trend" viewBox="0 0 <?php echo esc_attr( count( $trend ) * 30 ); ?> 56" role="img" aria-label="<?php echo esc_attr( sprintf( /* translators: %s: comma-separated numbers */ __( 'Weekly PAX posts, last %1$d weeks: %2$s', 'fort' ), count( $trend ), $label ) ); ?>">
						<?php foreach ( $trend as $i => $w ) : $h = round( 56 * (int) $w['posts'] / $max, 1 ); ?>
							<rect x="<?php echo esc_attr( $i * 30 ); ?>" y="<?php echo esc_attr( 56 - $h ); ?>" width="24" height="<?php echo esc_attr( $h ); ?>" class="<?php echo count( $trend ) - 1 === $i ? 'is-last' : ''; ?>"></rect>
						<?php endforeach; ?>
					</svg>
				<?php endif; ?>
				<?php if ( ! empty( $summary['top_aos'][0] ) ) : ?>
					<p class="fort-dim"><?php echo esc_html( sprintf( /* translators: 1: AO name, 2: number of posts */ __( 'Busiest AO: %1$s, %2$d posts.', 'fort' ), $summary['top_aos'][0]['ao'], (int) $summary['top_aos'][0]['posts'] ) ); ?>
						<a class="fort-accent2" href="<?php echo esc_url( FORT_STATS_URL ); ?>"><?php echo esc_html( __( 'Leaderboards & streaks', 'fort' ) ); ?></a></p>
				<?php endif; ?>
			</section>
		<?php endif; ?>

		<?php if ( ! empty( $region['three_fs'] ) ) : ?>
			<section id="every-week" class="fort-side-section fort-every-side">
				<h2 class="fort-h3 fort-side-section__head"><?php esc_html_e( 'Every week', 'fort' ); ?></h2>
				<?php fort_render_every_week( $region ); ?>
			</section>
		<?php endif; ?>
	</aside>
</div>

</main>
<?php
get_footer();
