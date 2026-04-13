import ReactOnRails from 'react-on-rails';
import App from '../components/App';

// Import stylesheets
import '../stylesheets/application.css';

const hydrationDelay = Number(new URLSearchParams(window.location.search).get('hydration_delay')) || 0;

if (hydrationDelay > 0) {
  setTimeout(() => {
    performance.mark('hydration-start');
    ReactOnRails.register({ App });
  }, hydrationDelay);
} else {
  performance.mark('hydration-start');
  ReactOnRails.register({ App });
}
