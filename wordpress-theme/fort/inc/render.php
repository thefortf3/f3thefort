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

/**
 * A backblast in a list: one from the stats API, or one of the site's own posts as its tidy record
 * (fort_post_bb(): pre-blasts show their event date and Q, announcements just their date).
 */
function fort_render_backblast( $b ) {
	$kind  = $b['kind'] ?? 'backblast';
	$p     = fort_date_parts( $b['date'] ?? '' );
	$url   = $b['url'] ?? ( ! empty( $b['event_id'] ) ? fort_backblast_url( $b ) : fort_ao_url( $b['ao'] ?? '' ) );
	$tag   = $url ? 'a' : 'div';
	$qs    = ! empty( $b['qs'] ) ? implode( ', ', array_map( 'strval', (array) $b['qs'] ) ) : '';
	$where = $b['ao'] ?? ( $b['topics'][0] ?? '' );
	$head  = array_filter( array( 'preblast' === $kind ? __( 'Pre-blast', 'fort' ) : '', $where ) );
	?>
	<<?php echo esc_html( $tag ); ?> class="fort-bb<?php echo 'backblast' !== $kind ? ' fort-bb--' . esc_attr( $kind ) : ''; ?>"<?php echo $url ? ' href="' . esc_url( $url ) . '"' : ''; ?>>
		<span class="fort-bb__head"><span class="fort-accent2"><?php echo esc_html( strtoupper( implode( ' · ', $head ) ) ); ?></span><?php echo $head && $p['short'] ? ' · ' : ''; ?><?php echo esc_html( $p['short'] ); ?></span>
		<span class="fort-bb__title"><?php echo esc_html( fort_backblast_title( $b ) ); ?></span>
		<?php if ( 'post' !== $kind ) : ?>
			<span class="fort-bb__meta">
				<?php if ( $qs ) : ?><?php echo esc_html( sprintf( /* translators: %s: Q handle(s) */ __( 'Q: %s', 'fort' ), $qs ) ); ?><?php endif; ?>
				<?php if ( 'backblast' === $kind ) : ?>
					<?php echo $qs ? ' · ' : ''; ?><?php echo esc_html( sprintf( /* translators: %d: PAX count */ _n( '%d PAX', '%d PAX', (int) ( $b['pax_count'] ?? 0 ), 'fort' ), (int) ( $b['pax_count'] ?? 0 ) ) ); ?>
					<?php $fngs = fort_fng_count( $b ); ?>
					<?php if ( $fngs ) : ?> · <span class="fort-amber"><?php echo esc_html( sprintf( '+%d FNG', (int) $fngs ) ); ?></span><?php endif; ?>
				<?php endif; ?>
			</span>
		<?php endif; ?>
		<?php if ( ! empty( $b['excerpt'] ) ) : ?>
			<span class="fort-bb__excerpt"><?php echo esc_html( $b['excerpt'] ); ?></span>
		<?php endif; ?>
	</<?php echo esc_html( $tag ); ?>>
	<?php
}

/** A WordPress post (backblast / pre-blast / announcement) in a list. */
function fort_render_post_card() {
	$r = fort_post_bb();
	if ( ! $r ) {
		$r = array( 'kind' => 'post', 'title' => get_the_title(), 'date' => get_the_date( 'Y-m-d' ) );
	}
	fort_render_backblast( array( 'url' => get_permalink() ) + $r );
}

/**
 * One backblast's page: the stats API's (backblast.php) or a post's tidy record (single.php).
 * When, where, the Q(s) and PAX, then the write-up.
 */
function fort_render_backblast_entry( $b ) {
	$kind = $b['kind'] ?? 'backblast';
	$p    = fort_date_parts( $b['date'] ?? '' );
	$ao   = $b['ao'] ?? '';
	// Stats backblasts link to the Backblasts page for their AO; posts to the AO's category.
	$ao_url = empty( $b['post_id'] ) ? fort_backblasts_url( array( 'ao' => $ao ) ) : fort_ao_url( $ao );
	$kick   = array_filter( array( 'preblast' === $kind ? __( 'Pre-blast', 'fort' ) : '', $ao, trim( $p['dow'] . ' ' . $p['mon'] . ' ' . $p['day'] ) ) );
	?>
	<a class="fort-more fort-back" href="<?php echo esc_url( fort_backblasts_url() ); ?>"><?php esc_html_e( '← All backblasts', 'fort' ); ?></a>
	<header class="fort-entry__head">
		<span class="fort-kicker fort-accent2"><?php echo esc_html( strtoupper( implode( ' · ', $kick ) ) ); ?></span>
		<h1 class="fort-entry__title"><?php echo esc_html( fort_backblast_title( $b ) ); ?></h1>
		<?php if ( ! empty( $b['topics'] ) ) : ?>
			<div class="fort-entry__tags"><?php foreach ( $b['topics'] as $t ) : ?><span class="fort-tag fort-accent2"><?php echo esc_html( strtoupper( $t ) ); ?></span><?php endforeach; ?></div>
		<?php endif; ?>
	</header>

	<?php if ( 'post' !== $kind ) : ?>
		<dl class="fort-facts">
			<?php if ( $p['long'] ) : ?>
				<dt><?php esc_html_e( 'When', 'fort' ); ?></dt>
				<dd><?php echo esc_html( $p['long'] ); ?><?php echo ! empty( $b['start_time'] ) ? ' <span class="fort-mono-dim">' . esc_html( $b['start_time'] ) . '</span>' : ''; ?></dd>
			<?php endif; ?>
			<?php if ( $ao ) : ?>
				<dt><?php esc_html_e( 'AO', 'fort' ); ?></dt>
				<dd>
					<?php echo $ao_url ? '<a href="' . esc_url( $ao_url ) . '">' . esc_html( $ao ) . '</a>' : esc_html( $ao ); ?>
					<?php if ( ! empty( $b['location'] ) && $b['location'] !== $ao ) : ?><span class="fort-mono-dim">· <?php echo esc_html( $b['location'] ); ?></span><?php endif; ?>
				</dd>
			<?php endif; ?>
			<?php if ( ! empty( $b['qs'] ) ) : ?>
				<dt><?php esc_html_e( 'Q', 'fort' ); ?></dt>
				<dd><?php echo esc_html( implode( ' & ', $b['qs'] ) ); ?><?php echo ! empty( $b['coqs'] ) ? ' <span class="fort-mono-dim">· ' . esc_html( sprintf( /* translators: %s: names */ __( 'Co-Q: %s', 'fort' ), implode( ', ', $b['coqs'] ) ) ) . '</span>' : ''; ?></dd>
			<?php endif; ?>
			<?php if ( 'backblast' === $kind ) : ?>
				<dt><?php esc_html_e( 'PAX', 'fort' ); ?></dt>
				<dd>
					<?php $fngs = fort_fng_count( $b ); ?>
					<?php echo esc_html( (int) ( $b['pax_count'] ?? 0 ) ); ?><?php echo $fngs ? ' <span class="fort-amber">' . esc_html( sprintf( '+%d FNG', (int) $fngs ) ) . '</span>' : ''; ?>
					<?php if ( ! empty( $b['pax'] ) ) : ?><span class="fort-bb-pax"><?php echo esc_html( implode( ', ', $b['pax'] ) ); ?></span><?php endif; ?>
				</dd>
			<?php endif; ?>
		</dl>
	<?php endif; ?>

	<?php if ( ! empty( $b['hero_html'] ) ) : ?>
		<figure class="fort-entry__hero"><?php echo $b['hero_html']; // phpcs:ignore WordPress.Security.EscapeOutput -- get_the_post_thumbnail() markup. ?></figure>
	<?php endif; ?>
	<div class="fort-prose fort-bb-body">
		<?php if ( isset( $b['body_html'] ) && '' !== $b['body_html'] ) : ?>
			<?php echo apply_filters( 'fort_backblast_body', $b['body_html'] ); // phpcs:ignore WordPress.Security.EscapeOutput -- filtered with wp_kses_post when the record was made. ?>
		<?php elseif ( ! empty( $b['paragraphs'] ) ) : ?>
			<?php foreach ( $b['paragraphs'] as $para ) : ?>
				<p><?php echo nl2br( esc_html( $para ) ); ?></p>
			<?php endforeach; ?>
		<?php else : ?>
			<p class="fort-dim"><?php esc_html_e( 'No write-up for this one.', 'fort' ); ?></p>
		<?php endif; ?>
	</div>
	<?php if ( ! empty( $b['posted'] ) && $b['posted'] !== ( $b['date'] ?? '' ) ) : ?>
		<?php /* translators: %s: date the post went up */ ?>
		<p class="fort-mono-dim"><?php echo esc_html( sprintf( __( 'Posted %s', 'fort' ), fort_date_parts( $b['posted'] )['long'] ) ); ?></p>
	<?php endif; ?>

	<?php if ( $ao && $ao_url ) : ?>
		<p class="fort-actions">
			<?php /* translators: %s: AO name */ ?>
			<a class="fort-btn fort-btn--outline" href="<?php echo esc_url( $ao_url ); ?>"><?php echo esc_html( sprintf( __( 'More from %s', 'fort' ), $ao ) ); ?></a>
		</p>
	<?php endif; ?>
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

/**
 * The full schedule: $count days from day $offset, one block per day with each workout on one
 * line (time · AO, with 2nd/3rd F tagged · Q), then the AOs' site Qs listed once.
 */
function fort_render_schedule_page( $schedule, $kind = '', $offset = 0, $count = 7 ) {
	$today    = $schedule['from'];
	$tomorrow = gmdate( 'Y-m-d', strtotime( $today . ' +1 day' ) );
	$site_qs  = $schedule['aos'] ?? array();
	$labels   = array( '2nd' => __( '2nd F', 'fort' ), '3rd' => __( '3rd F', 'fort' ) );
	$shown    = array();
	echo '<div class="fort-sched">';
	foreach ( array_slice( $schedule['days'] ?? array(), $offset, $count ) as $day ) {
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
		<section class="fort-sched__day<?php echo $day['date'] === $today ? ' is-today' : ''; ?><?php echo $rows ? '' : ' is-empty'; ?>" aria-label="<?php echo esc_attr( gmdate( 'l, F j', $ts ) ); ?>">
			<h2 class="fort-sched__date"><span><?php echo esc_html( $name ); ?></span> <span class="fort-mono-dim"><?php echo esc_html( strtoupper( gmdate( 'M j', $ts ) ) ); ?></span></h2>
			<?php if ( ! $rows ) : ?>
				<p class="fort-dim fort-sched__none"><?php esc_html_e( 'Nothing on the Q sheet.', 'fort' ); ?></p>
			<?php else : ?>
				<ul class="fort-sched__list">
					<?php
					foreach ( $rows as $w ) :
						$k      = fort_event_kind( $w['event_type'] ?? '' );
						$ao_url = fort_ao_url( $w['ao'] );
						$sq     = $site_qs[ $w['ao'] ]['site_qs'] ?? array();
						$title  = $sq ? sprintf( /* translators: %s: site Q name(s) */ __( 'Site Q: %s', 'fort' ), implode( ', ', $sq ) ) : '';
						if ( $sq ) {
							$shown[ $w['ao'] ] = $sq;
						}
						?>
						<li class="fort-sched__row<?php echo '1st' === $k ? '' : ' is-other'; ?>">
							<span class="fort-sched__time"><?php echo esc_html( $w['start_time'] ); ?></span>
							<span class="fort-sched__ao"<?php echo $title ? ' title="' . esc_attr( $title ) . '"' : ''; ?>>
								<?php echo $ao_url ? '<a href="' . esc_url( $ao_url ) . '">' . esc_html( $w['ao'] ) . '</a>' : esc_html( $w['ao'] ); ?>
								<?php if ( isset( $labels[ $k ] ) ) : ?><span class="fort-tag fort-tag--muted"><?php echo esc_html( $labels[ $k ] ); ?></span><?php endif; ?>
							</span>
							<span class="fort-sched__q"><span class="screen-reader-text"><?php esc_html_e( 'Q:', 'fort' ); ?> </span><?php echo esc_html( implode( ' & ', $w['qs'] ) ); ?></span>
						</li>
					<?php endforeach; ?>
				</ul>
			<?php endif; ?>
		</section>
		<?php
	}
	echo '</div>';

	if ( $shown ) {
		ksort( $shown, SORT_NATURAL | SORT_FLAG_CASE );
		?>
		<details class="fort-siteqs">
			<summary><?php esc_html_e( 'Site Qs', 'fort' ); ?> <span class="fort-dim"><?php esc_html_e( '— the men who run each AO', 'fort' ); ?></span></summary>
			<ul class="fort-siteqs__list">
				<?php foreach ( $shown as $ao => $names ) : ?>
					<li><span class="fort-siteqs__ao"><?php echo esc_html( $ao ); ?></span> <?php echo esc_html( implode( ', ', $names ) ); ?></li>
				<?php endforeach; ?>
			</ul>
		</details>
		<?php
	}
}
