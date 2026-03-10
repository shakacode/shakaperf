import ReactOnRails from 'react-on-rails';
import App from '../components/App';

// Import stylesheets
import '../stylesheets/application.css';

performance.mark('hydration-start');

// Register components with React on Rails
ReactOnRails.register({ App });
