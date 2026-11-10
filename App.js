import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import HomeScreen from './src/screens/HomeScreen';
import CreateOrderScreen from './src/screens/CreateOrderScreen';

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Home">
        <Stack.Screen 
          name="Home" 
          component={HomeScreen} 
          options={{ title: 'Órdenes de Servicio' }} 
        />
        <Stack.Screen 
          name="CreateOrder" 
          component={CreateOrderScreen} 
          options={{ title: 'Nueva Orden de Servicio' }} 
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}