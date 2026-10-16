ALTER TABLE ONLY campaign_banners
    DROP CONSTRAINT campaign_banners_tenant_image_id_fkey;

DROP TABLE campaign_banner_image_variants;

DROP TABLE campaign_banner_images;

DROP TABLE campaign_banners;
