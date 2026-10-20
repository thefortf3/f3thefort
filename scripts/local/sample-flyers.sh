#!/usr/bin/env bash
# Local only: gives the local WordPress's events real flyers from past issues of The Fort Weekly.
#
# The images are downloaded (read-only) from the production app's public uploads into the local
# media library, once each, and set as each event's flyer (featured image). Nothing is sent
# anywhere else.
#
# Ruck and Roll, Beers for Beetus and Turkey Day Convergence get their own flyers; the rest get a
# fitting flyer from another issue as a stand-in. Coffeteria and Yoga are left without one (weekly
# items rarely have flyers, and it keeps the no-image layout covered).
#
# Usage: scripts/local/sample-flyers.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

docker compose -f docker-compose.local.yml run -T --rm wpcli wp eval-file - <<'PHP'
<?php
$src = 'https://submit.f3thefort.com/uploads/';
$map = array(
	'q-school-its-back'                     => '1786229833804-whrwf2.png',
	'ruck-and-roll'                         => '1789843534361-4gzf3f.jpeg',
	'beers-for-beetus'                      => '1790974948612-76ol0z.PNG',
	'turkey-day-convergence'                => '1789089913124-3ggrfm.jpeg',
	'warrior-heart-mens-spiritual-bootcamp' => '1785625735830-cwigpz.png',
	'la-grama'                              => '1791808636925-8zut9w.jpeg',
	'bethel-mens-shelter-2'                 => '1785625858371-p6pfyr.png',
	'the-4-bs-its-back'                     => '1791555409941-19ubat.png',
	'coffeteria-east-and-west'              => '',
	'yoga-in-the-park'                      => '',
);
require_once ABSPATH . 'wp-admin/includes/media.php';
require_once ABSPATH . 'wp-admin/includes/file.php';
require_once ABSPATH . 'wp-admin/includes/image.php';
foreach ( $map as $slug => $file ) {
	$ids = get_posts( array( 'post_type' => 'fort_event', 'name' => $slug, 'post_status' => 'any', 'fields' => 'ids', 'posts_per_page' => 1 ) );
	if ( ! $ids ) {
		echo "skip   $slug (not in the local data)\n";
		continue;
	}
	if ( '' === $file ) {
		delete_post_thumbnail( $ids[0] );
		echo "set    $slug -> (no flyer)\n";
		continue;
	}
	$url  = $src . $file;
	$have = get_posts( array( 'post_type' => 'attachment', 'post_status' => 'inherit', 'fields' => 'ids', 'posts_per_page' => 1, 'meta_key' => '_fort_source_url', 'meta_value' => $url ) );
	$att  = $have ? $have[0] : media_sideload_image( $url, $ids[0], get_the_title( $ids[0] ), 'id' );
	if ( is_wp_error( $att ) ) {
		echo "fail   $slug: " . $att->get_error_message() . "\n";
		continue;
	}
	update_post_meta( $att, '_fort_source_url', $url );
	set_post_thumbnail( $ids[0], $att );
	echo "set    $slug -> $file\n";
}
PHP
