import React, { useState, useCallback, useMemo } from 'react';
import {
  Box,
  Typography,
  Chip,
  Paper,
  Stack,
  LinearProgress,
  Collapse,
  Alert,
  AlertTitle,
  Switch,
  FormControlLabel,
  ToggleButton,
  ToggleButtonGroup,
  Stepper,
  Step,
  StepLabel,
} from '@mui/material';
import {
  CheckCircle,
  Cancel,
  Nature,
  VerifiedUser,
  LocalOffer,
  Straighten,
  Print,
  Save,
  FileCopy,
  Edit,
} from '@mui/icons-material';

// Large data structure to increase bundle size
const FEATURE_CATEGORIES = {
  sustainability: {
    title: 'Sustainability',
    icon: Nature,
    color: '#4caf50',
    features: [
      { name: 'Eco-friendly materials', available: true, description: 'Made with sustainable, environmentally conscious materials' },
      { name: 'Carbon neutral shipping', available: true, description: 'All shipments offset with verified carbon credits' },
      { name: 'Recyclable packaging', available: true, description: '100% recyclable and biodegradable packaging materials' },
      { name: 'Ethical sourcing', available: true, description: 'Materials sourced from certified ethical suppliers' },
    ],
  },
  quality: {
    title: 'Quality Assurance',
    icon: VerifiedUser,
    color: '#2196f3',
    features: [
      { name: 'Premium materials', available: true, description: 'Only the finest quality materials used in production' },
      { name: 'Rigorous testing', available: true, description: 'Each product undergoes 50+ quality checks' },
      { name: 'Extended warranty', available: true, description: 'Industry-leading warranty coverage' },
      { name: 'Expert craftsmanship', available: true, description: 'Handcrafted by skilled artisans' },
    ],
  },
  value: {
    title: 'Value Proposition',
    icon: LocalOffer,
    color: '#ff9800',
    features: [
      { name: 'Competitive pricing', available: true, description: 'Best-in-class value for premium quality' },
      { name: 'Free returns', available: true, description: 'Hassle-free 30-day return policy' },
      { name: 'Loyalty rewards', available: true, description: 'Earn points on every purchase' },
      { name: 'Price match guarantee', available: false, description: 'We match competitor prices' },
    ],
  },
};

const PRODUCT_TIMELINE = [
  { date: '2024-01-01', event: 'Design phase completed', status: 'completed' },
  { date: '2024-02-15', event: 'Prototype testing', status: 'completed' },
  { date: '2024-03-01', event: 'Production started', status: 'completed' },
  { date: '2024-03-20', event: 'Quality assurance', status: 'completed' },
  { date: '2024-04-01', event: 'Product launch', status: 'current' },
];

const QUALITY_METRICS = [
  { label: 'Durability', value: 95, color: '#4caf50' },
  { label: 'Comfort', value: 88, color: '#2196f3' },
  { label: 'Style', value: 92, color: '#9c27b0' },
  { label: 'Value', value: 85, color: '#ff9800' },
  { label: 'Sustainability', value: 90, color: '#00bcd4' },
];


const SIZE_CHART = {
  XS: { chest: '32-34"', waist: '26-28"', hip: '34-36"', length: '26"' },
  S: { chest: '34-36"', waist: '28-30"', hip: '36-38"', length: '27"' },
  M: { chest: '36-38"', waist: '30-32"', hip: '38-40"', length: '28"' },
  L: { chest: '38-40"', waist: '32-34"', hip: '40-42"', length: '29"' },
  XL: { chest: '40-42"', waist: '34-36"', hip: '42-44"', length: '30"' },
  XXL: { chest: '42-44"', waist: '36-38"', hip: '44-46"', length: '31"' },
};

interface ProductFeaturesProps {
  productName?: string;
}

const ProductFeatures: React.FC<ProductFeaturesProps> = ({ productName = 'Product' }) => {
  const [expandedCategory, setExpandedCategory] = useState<string | null>('sustainability');
  const [showTimeline, setShowTimeline] = useState(false);
  const [selectedSize, setSelectedSize] = useState<string>('M');

  const handleCategoryToggle = useCallback((category: string) => {
    setExpandedCategory(prev => prev === category ? null : category);
  }, []);

  const totalFeatures = useMemo(() => {
    return Object.values(FEATURE_CATEGORIES).reduce((acc, cat) =>
      acc + cat.features.filter(f => f.available).length, 0
    );
  }, []);

  return (
    <Paper elevation={0} sx={{ p: 3, mt: 3, border: '1px solid #e0e0e0', borderRadius: 2 }}>
      <Typography variant="h6" fontWeight={600} gutterBottom>
        {productName} Features & Details
      </Typography>

      <Alert severity="info" sx={{ mb: 3 }}>
        <AlertTitle>Premium Quality Guaranteed</AlertTitle>
        This product includes {totalFeatures} verified features across sustainability, quality, and value.
      </Alert>

      {/* Quality Metrics */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="subtitle1" fontWeight={500} gutterBottom>
          Quality Metrics
        </Typography>
        <Stack spacing={2}>
          {QUALITY_METRICS.map((metric) => (
            <Box key={metric.label}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                <Typography variant="body2">{metric.label}</Typography>
                <Typography variant="body2" fontWeight={500}>{metric.value}%</Typography>
              </Box>
              <LinearProgress
                variant="determinate"
                value={metric.value}
                sx={{
                  height: 8,
                  borderRadius: 4,
                  bgcolor: '#e0e0e0',
                  '& .MuiLinearProgress-bar': { bgcolor: metric.color }
                }}
              />
            </Box>
          ))}
        </Stack>
      </Box>

      {/* Feature Categories */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="subtitle1" fontWeight={500} gutterBottom>
          Feature Categories
        </Typography>
        {Object.entries(FEATURE_CATEGORIES).map(([key, category]) => (
          <Paper
            key={key}
            sx={{ mb: 1, cursor: 'pointer', overflow: 'hidden' }}
            variant="outlined"
          >
            <Box
              sx={{
                p: 2,
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                bgcolor: expandedCategory === key ? `${category.color}10` : 'transparent'
              }}
              onClick={() => handleCategoryToggle(key)}
            >
              <category.icon sx={{ color: category.color }} />
              <Typography fontWeight={500} sx={{ flex: 1 }}>{category.title}</Typography>
              <Chip
                label={`${category.features.filter(f => f.available).length}/${category.features.length}`}
                size="small"
                sx={{ bgcolor: category.color, color: 'white' }}
              />
            </Box>
            <Collapse in={expandedCategory === key}>
              <Box sx={{ p: 2, pt: 0 }}>
                {category.features.map((feature, idx) => (
                  <Box key={idx} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, py: 1 }}>
                    {feature.available ? (
                      <CheckCircle sx={{ color: '#4caf50', fontSize: 20 }} />
                    ) : (
                      <Cancel sx={{ color: '#bdbdbd', fontSize: 20 }} />
                    )}
                    <Box>
                      <Typography variant="body2" fontWeight={500}>{feature.name}</Typography>
                      <Typography variant="caption" color="text.secondary">{feature.description}</Typography>
                    </Box>
                  </Box>
                ))}
              </Box>
            </Collapse>
          </Paper>
        ))}
      </Box>

      {/* Size Selection */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="subtitle1" fontWeight={500} gutterBottom>
          <Straighten sx={{ fontSize: 18, mr: 1, verticalAlign: 'middle' }} />
          Size Chart
        </Typography>
        <ToggleButtonGroup
          value={selectedSize}
          exclusive
          onChange={(_, value) => value && setSelectedSize(value)}
          sx={{ mb: 2 }}
        >
          {Object.keys(SIZE_CHART).map((size) => (
            <ToggleButton key={size} value={size}>{size}</ToggleButton>
          ))}
        </ToggleButtonGroup>
        {selectedSize && (
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack direction="row" spacing={3} flexWrap="wrap">
              <Box><Typography variant="caption" color="text.secondary">Chest</Typography><Typography variant="body2">{SIZE_CHART[selectedSize as keyof typeof SIZE_CHART].chest}</Typography></Box>
              <Box><Typography variant="caption" color="text.secondary">Waist</Typography><Typography variant="body2">{SIZE_CHART[selectedSize as keyof typeof SIZE_CHART].waist}</Typography></Box>
              <Box><Typography variant="caption" color="text.secondary">Hip</Typography><Typography variant="body2">{SIZE_CHART[selectedSize as keyof typeof SIZE_CHART].hip}</Typography></Box>
              <Box><Typography variant="caption" color="text.secondary">Length</Typography><Typography variant="body2">{SIZE_CHART[selectedSize as keyof typeof SIZE_CHART].length}</Typography></Box>
            </Stack>
          </Paper>
        )}
      </Box>

      {/* Timeline Toggle */}
      <FormControlLabel
        control={<Switch checked={showTimeline} onChange={(e) => setShowTimeline(e.target.checked)} />}
        label="Show Product Journey"
      />

      <Collapse in={showTimeline}>
        <Box sx={{ mt: 2 }}>
          <Stepper orientation="vertical">
            {PRODUCT_TIMELINE.map((item, index) => (
              <Step key={index} active={item.status === 'current'} completed={item.status === 'completed'}>
                <StepLabel>
                  <Typography variant="body2" fontWeight={500}>{item.event}</Typography>
                  <Typography variant="caption" color="text.secondary">{item.date}</Typography>
                </StepLabel>
              </Step>
            ))}
          </Stepper>
        </Box>
      </Collapse>
    </Paper>
  );
};

export default ProductFeatures;
