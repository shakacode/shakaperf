import React from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  Paper,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';

const mockProducts = [
  { id: 1, name: 'Product A', price: 29.99, stock: 150, category: 'Electronics' },
  { id: 2, name: 'Product B', price: 49.99, stock: 75, category: 'Clothing' },
  { id: 3, name: 'Product C', price: 19.99, stock: 200, category: 'Home' },
  { id: 4, name: 'Product D', price: 99.99, stock: 30, category: 'Electronics' },
  { id: 5, name: 'Product E', price: 14.99, stock: 500, category: 'Accessories' },
];

const ProductManagement: React.FC = () => {
  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">Product Management</Typography>
        <Button variant="contained" startIcon={<AddIcon />}>
          Add Product
        </Button>
      </Box>
      <Card>
        <CardContent>
          <TableContainer component={Paper} elevation={0}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>ID</TableCell>
                  <TableCell>Name</TableCell>
                  <TableCell>Category</TableCell>
                  <TableCell align="right">Price</TableCell>
                  <TableCell align="right">Stock</TableCell>
                  <TableCell align="center">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {mockProducts.map((product) => (
                  <TableRow key={product.id}>
                    <TableCell>{product.id}</TableCell>
                    <TableCell>{product.name}</TableCell>
                    <TableCell>{product.category}</TableCell>
                    <TableCell align="right">${product.price.toFixed(2)}</TableCell>
                    <TableCell align="right">{product.stock}</TableCell>
                    <TableCell align="center">
                      <Button size="small" startIcon={<EditIcon />}>
                        Edit
                      </Button>
                      <Button size="small" color="error" startIcon={<DeleteIcon />}>
                        Delete
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>
    </Box>
  );
};

export default ProductManagement;
