<?php
/**
 * Markup for the agenda pieces shared by the homepage, entry pages and archives.
 * Every value from the APIs is escaped here; description HTML was sanitized by the app.
 *
 * @package Fort
 */

defined( 'ABSPATH' ) || exit;

/** A "This week" entry: time + tag, linked title, meta, summary, links, optional flyer. */
function fort_render_week_entry( $e ) {
	$img  = fort_entry_image( $e );
	$meta = fort_entry_meta( $e );
	?>
	<article class="fort-week-entry<?php echo $img ? ' has-thumb' : ''; ?>">
		<div class="fort-week-entry__body">
			<div class="fort-when"><?php echo esc_html( fort_time_label( $e['next_occurrence'] ?? array() ) ); ?><?php echo fort_tag_chip( $e ); // phpcs:ignore WordPress.Security.EscapeOutput -- escaped in helper ?></div>
			<h3 class="fort-entry-title"><a href="<?php echo esc_url( fort_event_url( $e ) ); ?>"><?php echo esc_html( $e['title'] ); ?></a></h3>
			<?php if ( $meta ) : ?><div class="fort-meta"><?php echo esc_html( $meta ); ?></div><?php endif; ?>
			<p class="fort-summary"><?php echo esc_html( fort_summary( $e, 34 ) ); ?></p>
			<a class="fort-more" href="<?php echo esc_url( fort_event_url( $e ) ); ?>"><?php esc_html_e( 'Details →', 'fort' ); ?></a>
		</div>
		<?php if ( $img ) : ?>
			<a class="fort-thumb" href="<?php echo esc_url( fort_event_url( $e ) ); ?>"><img src="<?php echo esc_url( $img ); ?>" alt="<?php echo esc_attr( sprintf( /* translators: %s: entry title */ __( 'Flyer for %s', 'fort' ), $e['title'] ) ); ?>" loading="lazy"></a>
		<?php endif; ?>
	</article>
	<?php
}

/** One day of "This week": the big date on the left, its entries on the right. */
function fort_render_day( $day ) {
	$p = fort_date_parts( $day['date'] );
	?>
	<div class="fort-day">
		<div class="fort-day__date"><span class="fort-day__dow"><?php echo esc_html( $p['dow'] ); ?></span><span class="fort-day__num"><?php echo esc_html( $p['day'] ); ?></span><span class="fort-day__mon"><?php echo esc_html( $p['mon'] ); ?></span></div>
		<div class="fort-day__entries">
			<?php foreach ( $day['entries'] as $e ) { fort_render_week_entry( $e ); } ?>
		</div>
	</div>
	<?php
}

/** A compact "Coming up" row. */
function fort_render_coming_row( $e ) {
	$p    = fort_date_parts( $e['next_occurrence']['date'] );
	$more = max( 0, count( $e['upcoming_dates'] ?? array() ) - 1 );
	?>
	<a class="fort-coming" href="<?php echo esc_url( fort_event_url( $e ) ); ?>">
		<span class="fort-coming__date"><span class="fort-day__dow"><?php echo esc_html( $p['mon'] ); ?></span><span class="fort-coming__num"><?php echo esc_html( $p['day'] ); ?></span></span>
		<span class="fort-coming__body">
			<span class="fort-coming__title"><?php echo esc_html( $e['title'] ); ?></span>
			<span class="fort-coming__summary"><?php echo esc_html( fort_summary( $e, 18 ) ); ?></span>
			<span class="fort-coming__meta"><?php echo fort_tag_chip( $e ); // phpcs:ignore WordPress.Security.EscapeOutput ?><?php echo esc_html( fort_entry_meta( $e, true ) ); ?><?php echo $more ? esc_html( sprintf( /* translators: %d: number of later dates */ _n( ' · +%d more date', ' · +%d more dates', $more, 'fort' ), $more ) ) : ''; ?></span>
		</span>
	</a>
	<?php
}

/** A backblast card from the stats API. */
function fort_render_backblast( $b ) {
	$p     = fort_date_parts( $b['date'] ?? '' );
	$url   = ! empty( $b['url'] ) ? $b['url'] : fort_ao_url( $b['ao'] ?? '' );
	$tag   = $url ? 'a' : 'div';
	$title = ! empty( $b['title'] ) ? $b['title'] : sprintf( /* translators: %s: AO name */ __( '%s beatdown', 'fort' ), $b['ao'] ?? '' );
	$qs    = ! empty( $b['qs'] ) ? implode( ', ', array_map( 'strval', (array) $b['qs'] ) ) : '';
	?>
	<<?php echo esc_html( $tag ); ?> class="fort-bb"<?php echo $url ? ' href="' . esc_url( $url ) . '"' : ''; ?>>
		<span class="fort-bb__head"><span class="fort-accent2"><?php echo esc_html( strtoupper( $b['ao'] ?? '' ) ); ?></span> · <?php echo esc_html( trim( $p['dow'] . ' ' . $p['mon'] . ' ' . $p['day'] ) ); ?></span>
		<span class="fort-bb__title"><?php echo esc_html( $title ); ?></span>
		<span class="fort-bb__meta">
			<?php if ( $qs ) : ?><?php echo esc_html( sprintf( /* translators: %s: Q handle(s) */ __( 'Q: %s', 'fort' ), $qs ) ); ?> · <?php endif; ?>
			<?php echo esc_html( sprintf( /* translators: %d: PAX count */ _n( '%d PAX', '%d PAX', (int) ( $b['pax_count'] ?? 0 ), 'fort' ), (int) ( $b['pax_count'] ?? 0 ) ) ); ?>
			<?php if ( ! empty( $b['fng_count'] ) ) : ?> · <span class="fort-amber"><?php echo esc_html( sprintf( '+%d FNG', (int) $b['fng_count'] ) ); ?></span><?php endif; ?>
		</span>
	</<?php echo esc_html( $tag ); ?>>
	<?php
}

/** A WordPress post (backblast / pre-blast) in a list. */
function fort_render_post_card() {
	$cat = fort_post_ao();
	$ao  = $cat ? $cat->name : '';
	?>
	<a class="fort-bb" href="<?php the_permalink(); ?>">
		<span class="fort-bb__head"><span class="fort-accent2"><?php echo esc_html( strtoupper( $ao ) ); ?></span> · <?php echo esc_html( strtoupper( get_the_date( 'D M j' ) ) ); ?></span>
		<span class="fort-bb__title"><?php the_title(); ?></span>
		<?php
		$f = fort_backblast_fields( get_the_content() );
		if ( ! empty( $f['qic'] ) ) :
			?>
			<span class="fort-bb__meta"><?php echo esc_html( sprintf( /* translators: %s: QIC */ __( 'Q: %s', 'fort' ), $f['qic'] ) ); ?></span>
		<?php endif; ?>
	</a>
	<?php
}

/** Upcoming workouts: "Today" and "Tomorrow", each workout as time · AO · Q. */
function fort_render_schedule( $schedule, $today ) {
	$days = array_values( array_filter( $schedule['days'] ?? array(), fn( $d ) => ! empty( $d['workouts'] ) ) );
	if ( ! $days ) {
		echo '<p class="fort-dim fort-empty">' . esc_html__( 'No workouts on the schedule for today or tomorrow yet.', 'fort' ) . '</p>';
		return;
	}
	$tomorrow = gmdate( 'Y-m-d', strtotime( $today . ' +1 day' ) );
	echo '<div class="fort-lineup-days">';
	foreach ( $days as $day ) {
		$p     = fort_date_parts( $day['date'] );
		$label = $day['date'] === $today ? __( 'Today', 'fort' ) : ( $day['date'] === $tomorrow ? __( 'Tomorrow', 'fort' ) : $p['long'] );
		?>
		<div class="fort-lineup">
			<h3 class="fort-lineup__day"><span><?php echo esc_html( $label ); ?></span><span class="fort-mono-dim"><?php echo esc_html( $p['dow'] . ' ' . $p['mon'] . ' ' . $p['day'] ); ?></span></h3>
			<ul class="fort-lineup__list">
				<?php foreach ( $day['workouts'] as $w ) : $ao_url = fort_ao_url( $w['ao'] ); ?>
					<li class="fort-lineup__row<?php echo empty( $w['is_workout'] ) ? ' is-other' : ''; ?>">
						<span class="fort-lineup__time"><?php echo esc_html( $w['start_time'] ); ?></span>
						<span class="fort-lineup__ao"><?php echo $ao_url ? '<a href="' . esc_url( $ao_url ) . '">' . esc_html( $w['ao'] ) . '</a>' : esc_html( $w['ao'] ); ?></span>
						<span class="fort-lineup__q"><?php echo esc_html( implode( ' & ', $w['qs'] ) ); ?></span>
					</li>
				<?php endforeach; ?>
			</ul>
		</div>
		<?php
	}
	echo '</div>';
}

/** "Every week" (the Three F's) list for the sidebar. */
function fort_render_every_week( $region ) {
	foreach ( $region['three_fs'] ?? array() as $col ) {
		$events = array_filter( $col['items'], fn( $i ) => 'event' === $i['type'] && ! empty( $i['name'] ) );
		$links  = array_filter( $col['items'], fn( $i ) => 'link' === $i['type'] && ! empty( $i['url'] ) );
		if ( ! $events && ! $links ) {
			continue;
		}
		?>
		<div class="fort-every__col">
			<div class="fort-label fort-accent2"><?php echo esc_html( strtoupper( $col['column'] ) ); ?></div>
			<?php foreach ( $events as $i ) : ?>
				<div class="fort-every__item"><?php echo esc_html( $i['name'] ); ?> <span class="fort-mono-dim"><?php echo esc_html( $i['detail'] ?? '' ); ?></span></div>
			<?php endforeach; ?>
			<?php foreach ( $links as $i ) : ?>
				<a class="fort-more fort-accent2" href="<?php echo esc_url( $i['url'] ); ?>"><?php echo esc_html( $i['label'] ); ?> ↗</a>
			<?php endforeach; ?>
		</div>
		<?php
	}
}

/** GloomSchedule's event type → 1st / 2nd / 3rd F ('' if it isn't one of the three). */
function fort_event_kind( $type ) {
	$t = strtolower( (string) $type );
	if ( 0 === strpos( $t, '1st' ) ) {
		return '1st';
	}
	if ( 0 === strpos( $t, '2nd' ) ) {
		return '2nd';
	}
	if ( 0 === strpos( $t, '3rd' ) ) {
		return '3rd';
	}
	return '';
}

/** The full schedule: one block per day, each workout as time · AO (+ kind) · Q · site Q. */
function fort_render_schedule_page( $schedule, $kind = '' ) {
	$today    = $schedule['from'];
	$tomorrow = gmdate( 'Y-m-d', strtotime( $today . ' +1 day' ) );
	$site_qs  = $schedule['aos'] ?? array();
	$labels   = array( '2nd' => __( '2nd F', 'fort' ), '3rd' => __( '3rd F', 'fort' ) );
	echo '<div class="fort-sched">';
	foreach ( $schedule['days'] ?? array() as $day ) {
		$rows = array_values(
			array_filter(
				$day['workouts'],
				function ( $w ) use ( $kind ) {
					return '' === $kind || fort_event_kind( $w['event_type'] ?? '' ) === $kind;
				}
			)
		);
		$ts   = strtotime( $day['date'] . ' 00:00:00 UTC' );
		$name = $day['date'] === $today ? __( 'Today', 'fort' ) : ( $day['date'] === $tomorrow ? __( 'Tomorrow', 'fort' ) : gmdate( 'l', $ts ) );
		?>
		<section class="fort-sched__day<?php echo $day['date'] === $today ? ' is-today' : ''; ?>" aria-label="<?php echo esc_attr( gmdate( 'l, F j', $ts ) ); ?>">
			<h2 class="fort-sched__date"><span><?php echo esc_html( $name ); ?></span> <span class="fort-mono-dim"><?php echo esc_html( strtoupper( gmdate( 'D M j', $ts ) ) ); ?></span></h2>
			<?php if ( ! $rows ) : ?>
				<p class="fort-dim fort-sched__none"><?php esc_html_e( 'Nothing on the Q sheet yet.', 'fort' ); ?></p>
			<?php else : ?>
				<ul class="fort-sched__list">
					<?php foreach ( $rows as $w ) : $k = fort_event_kind( $w['event_type'] ?? '' ); $ao_url = fort_ao_url( $w['ao'] ); $sq = $site_qs[ $w['ao'] ]['site_qs'] ?? array(); ?>
						<li class="fort-sched__row<?php echo '1st' === $k ? '' : ' is-other'; ?>">
							<span class="fort-sched__time"><?php echo esc_html( $w['start_time'] ); ?></span>
							<span class="fort-sched__ao">
								<?php echo $ao_url ? '<a href="' . esc_url( $ao_url ) . '">' . esc_html( $w['ao'] ) . '</a>' : esc_html( $w['ao'] ); ?>
								<?php if ( isset( $labels[ $k ] ) ) : ?><span class="fort-tag fort-tag--muted"><?php echo esc_html( $labels[ $k ] ); ?></span><?php endif; ?>
							</span>
							<span class="fort-sched__q"><span class="fort-sched__lbl"><?php esc_html_e( 'Q', 'fort' ); ?></span> <?php echo esc_html( implode( ' & ', $w['qs'] ) ); ?></span>
							<span class="fort-sched__site"><?php if ( $sq ) : ?><span class="fort-sched__lbl"><?php esc_html_e( 'Site Q', 'fort' ); ?></span> <?php echo esc_html( implode( ', ', $sq ) ); ?><?php endif; ?></span>
						</li>
					<?php endforeach; ?>
				</ul>
			<?php endif; ?>
		</section>
		<?php
	}
	echo '</div>';
}
