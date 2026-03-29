export const GA_MEASUREMENT_ID = "G-XXXXXXXXXX";

export const pageview = (url: string) => {
  window.gtag("config", GA_MEASUREMENT_ID, {
    page_path: url,
  });
};

export const event = ({
  action,
  category,
  label,
}: {
  action: string;
  category: string;
  label: string;
}) => {
  window.gtag("event", action, {
    event_category: category,
    event_label: label,
  });
};
